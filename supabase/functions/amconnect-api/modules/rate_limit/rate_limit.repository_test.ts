import assert from "node:assert/strict";
import { RateLimitRepository } from "./rate_limit.repository.ts";
import { FakeSupabase, pgError } from "../../shared/testing/fake_supabase.ts";
import { AppError } from "../../shared/errors.ts";

Deno.test("repo: una sola RPC con bucket, límite y ventana; nunca manda el asesor", async () => {
  const fake = new FakeSupabase({}, {
    consume_rate_limit: { data: { allowed: true, remaining: 3, retryAfterSeconds: 0 }, error: null },
  });
  const res = await new RateLimitRepository(fake.client).consume("ai", { limit: 20, windowSeconds: 60 });
  assert.deepEqual(res, { allowed: true, remaining: 3, retryAfterSeconds: 0 });
  assert.deepEqual(fake.rpcCalls, [{ fn: "consume_rate_limit", args: { p_bucket: "ai", p_limit: 20, p_window_seconds: 60 } }]);
});

Deno.test("repo: error de la BD → AppError con detalle solo en internal", async () => {
  const fake = new FakeSupabase({}, { consume_rate_limit: { data: null, error: pgError("08006", "connection failure") } });
  await assert.rejects(
    () => new RateLimitRepository(fake.client).consume("general", { limit: 60, windowSeconds: 60 }),
    (e: unknown) => {
      assert.ok(e instanceof AppError);
      assert.doesNotMatch(e.message, /consume_rate_limit/);
      assert.match(e.internal ?? "", /08006/);
      return true;
    },
  );
});

Deno.test("repo: respuesta con forma inesperada → error (el service la trata como falla del contador)", async () => {
  const fake = new FakeSupabase({}, { consume_rate_limit: { data: null, error: null } });
  await assert.rejects(() => new RateLimitRepository(fake.client).consume("general", { limit: 60, windowSeconds: 60 }));
});
