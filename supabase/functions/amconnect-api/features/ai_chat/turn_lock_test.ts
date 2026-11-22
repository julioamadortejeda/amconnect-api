// Candado de turno por sesión (bug #6): adquirir, rechazar, expirar, liberar, RLS.
import "../../shared/testing/test_env.ts";
import assert from "node:assert/strict";
import { AiSessionService, TURN_LOCK_SECONDS } from "./ai_session.service.ts";
import { AiSessionRepository } from "./ai_session.repository.ts";
import { InMemoryAiSessionRepository } from "../../shared/testing/assistant_harness.ts";
import { FakeSupabase } from "../../shared/testing/fake_supabase.ts";

const ME = "a1a1a1a1-0000-4000-8000-00000000000a";
const OTHER = "b2b2b2b2-0000-4000-8000-00000000000b";

function setup() {
  const repo = new InMemoryAiSessionRepository(ME);
  repo.seedSession({ id: "s1", agentId: ME });
  return { repo, service: new AiSessionService(repo) };
}

Deno.test("candado: libre -> se toma; ocupado -> 409 RESOURCE_CONFLICT; liberado -> se vuelve a tomar", async () => {
  const { service } = setup();
  await service.acquireTurnLock("s1");
  await assert.rejects(() => service.acquireTurnLock("s1"), (e: { statusCode?: number; errorCode?: string }) =>
    e.statusCode === 409 && e.errorCode === "RESOURCE_CONFLICT");
  await service.releaseTurnLock("s1");
  await service.acquireTurnLock("s1");
});

Deno.test("candado: expira solo (crash-safe) tras TURN_LOCK_SECONDS", async () => {
  const { repo } = setup();
  const t0 = new Date("2026-01-01T00:00:00Z");
  assert.equal(await repo.acquireTurnLock("s1", t0, TURN_LOCK_SECONDS * 1000), true);
  const justBefore = new Date(t0.getTime() + TURN_LOCK_SECONDS * 1000 - 1);
  assert.equal(await repo.acquireTurnLock("s1", justBefore, TURN_LOCK_SECONDS * 1000), false);
  const after = new Date(t0.getTime() + TURN_LOCK_SECONDS * 1000 + 1);
  assert.equal(await repo.acquireTurnLock("s1", after, TURN_LOCK_SECONDS * 1000), true);
});

Deno.test("candado: sesión inexistente o ajena -> 404, no 409", async () => {
  const { repo, service } = setup();
  repo.seedSession({ id: "ajena", agentId: OTHER });
  for (const id of ["ajena", "no-existe"]) {
    await assert.rejects(() => service.acquireTurnLock(id), (e: { statusCode?: number }) => e.statusCode === 404);
  }
  assert.equal(repo.sessions.get("ajena")!.turnLockedUntil ?? null, null, "no se bloqueó la sesión ajena");
});

Deno.test("candado: un fallo al liberar no lanza (expira solo)", async () => {
  const { repo, service } = setup();
  repo.releaseTurnLock = () => Promise.reject(new Error("db caída"));
  const { error } = console;
  console.error = () => {};
  try {
    await service.releaseTurnLock("s1");
  } finally {
    console.error = error;
  }
});

Deno.test("repositorio: acquire es UN update condicional sobre ai_sessions con RETURNING", async () => {
  const fake = new FakeSupabase({ ai_sessions: { data: [{ id: "s1" }], error: null } });
  const now = new Date("2026-01-01T00:00:00Z");
  const ok = await new AiSessionRepository(fake.client).acquireTurnLock("s1", now, 120_000);
  assert.equal(ok, true);
  const q = fake.queriesTo("ai_sessions")[0];
  assert.equal(q.eq("id"), "s1");
  assert.deepEqual(q.args("update"), [{ turn_locked_until: "2026-01-01T00:02:00.000Z" }]);
  assert.deepEqual(q.args("or"), ["turn_locked_until.is.null,turn_locked_until.lt.2026-01-01T00:00:00.000Z"]);
  assert.ok(q.has("select"));
});

Deno.test("repositorio: sin filas devueltas (bloqueada o RLS) -> false", async () => {
  const fake = new FakeSupabase({ ai_sessions: { data: [], error: null } });
  assert.equal(await new AiSessionRepository(fake.client).acquireTurnLock("s1", new Date(), 1000), false);
});

Deno.test("repositorio: release pone turn_locked_until en null", async () => {
  const fake = new FakeSupabase({ ai_sessions: { data: null, error: null } });
  await new AiSessionRepository(fake.client).releaseTurnLock("s1");
  assert.deepEqual(fake.queriesTo("ai_sessions")[0].args("update"), [{ turn_locked_until: null }]);
});
