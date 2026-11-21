// Cuota y cobros: UsageService con repo falso, y UsageRepository con un
// cliente Supabase falso para probar que falla CERRADO cuando la BD falla.
import assert from "node:assert/strict";
import { UsageService } from "./usage.service.ts";
import { UsageRepository } from "./usage.repository.ts";
import { AppError } from "../../shared/errors.ts";
import { captureError, FakeUsageRepository } from "../../shared/testing/fakes.ts";
import { FakeSupabase, pgError } from "../../shared/testing/fake_supabase.ts";

const AGENT = "agent-1";

function setup() {
  const repo = new FakeUsageRepository();
  return { repo, service: new UsageService(repo) };
}

// ─── Cobrar ─────────────────────────────────────────────────────────────────

Deno.test("UsageService: cobrar un mensaje devuelve el chargeId del cobro", async () => {
  const { repo, service } = setup();
  repo.incrementResult = { data: { charge_id: "chg-42", chat_count: 3, ingestion_count: 0 }, error: null };

  assert.equal(await service.checkAndIncrementChat(AGENT), "chg-42");
  assert.deepEqual(repo.increments, [{ agentId: AGENT, field: "chat" }]);
});

Deno.test("UsageService: cobrar una ingesta devuelve su chargeId y cobra el campo ingestion", async () => {
  const { repo, service } = setup();
  repo.incrementResult = { data: { charge_id: "chg-ing", chat_count: 0, ingestion_count: 1 }, error: null };

  assert.equal(await service.checkAndIncrementIngestion(AGENT), "chg-ing");
  assert.deepEqual(repo.increments, [{ agentId: AGENT, field: "ingestion" }]);
});

for (const kind of ["chat", "ingestion"] as const) {
  Deno.test(`UsageService: límite alcanzado (${kind}) → QUOTA_EXCEEDED 429`, async () => {
    const { repo, service } = setup();
    repo.incrementResult = { data: null, error: { message: "quota_exceeded", code: "P0001" } };

    const err = await captureError<AppError>(() =>
      kind === "chat" ? service.checkAndIncrementChat(AGENT) : service.checkAndIncrementIngestion(AGENT)
    );
    assert.equal(err.statusCode, 429);
    assert.equal(err.errorCode, "QUOTA_EXCEEDED");
    assert.match(err.message, kind === "chat" ? /mensajes de chat/ : /ingestas/);
  });

  Deno.test(`UsageService: otro error de la BD (${kind}) → 500 sin internals en el mensaje`, async () => {
    const { repo, service } = setup();
    repo.incrementResult = { data: null, error: { message: "relation agent_monthly_usage is locked", code: "55P03" } };

    const err = await captureError<AppError>(() =>
      kind === "chat" ? service.checkAndIncrementChat(AGENT) : service.checkAndIncrementIngestion(AGENT)
    );
    assert.equal(err.statusCode, 500);
    assert.equal(err.message.includes("agent_monthly_usage"), false, "el mensaje público no nombra tablas");
    assert.equal(err.internal?.includes("agent_monthly_usage"), true, "el detalle va en internal");
  });
}

// ─── Devolver ───────────────────────────────────────────────────────────────

Deno.test("UsageService: refundCharge(null) no hace nada (no hubo cobro)", async () => {
  const { repo, service } = setup();
  await service.refundCharge(null);
  assert.deepEqual(repo.refunds, []);
});

Deno.test("UsageService: refundCharge con id devuelve exactamente ese cobro", async () => {
  const { repo, service } = setup();
  await service.refundCharge("chg-7");
  assert.deepEqual(repo.refunds, ["chg-7"]);
});

// ─── Consultar ──────────────────────────────────────────────────────────────

Deno.test("UsageService: sin fila del mes el uso es cero y consulta el primer día del mes", async () => {
  const { repo, service } = setup();
  repo.monthlyUsage = null;

  assert.deepEqual(await service.getMonthlyUsage(AGENT), { chatCount: 0, ingestionCount: 0 });
  assert.match(repo.monthlyQueries[0].yearMonth, /^\d{4}-\d{2}-01$/);
});

Deno.test("UsageService: checkChatQuotaOnly deja pasar debajo del límite y frena al llegar", async () => {
  const { repo, service } = setup();
  repo.chatLimit = 10;

  repo.monthlyUsage = { chatCount: 9, ingestionCount: 0 };
  await service.checkChatQuotaOnly(AGENT);

  repo.monthlyUsage = { chatCount: 10, ingestionCount: 0 };
  const err = await captureError<AppError>(() => service.checkChatQuotaOnly(AGENT));
  assert.equal(err.errorCode, "QUOTA_EXCEEDED");
  assert.deepEqual(repo.increments, [], "solo consulta, no cobra");
});

// ─── Repositorio: fallar cerrado ────────────────────────────────────────────

Deno.test("UsageRepository: si la BD falla al leer el uso, lanza (no asume 0 y regala cuota)", async () => {
  const db = new FakeSupabase({ agent_monthly_usage: { data: null, error: pgError("57014", "statement timeout") } });
  const err = await captureError<AppError>(() => new UsageRepository(db.client).getMonthlyUsage(AGENT, "2026-11-01"));
  assert.ok(err instanceof AppError);
  assert.equal(err.statusCode, 500);
});

Deno.test("UsageRepository: si la BD falla al leer el límite, lanza (no asume 0 y bloquea al asesor)", async () => {
  const db = new FakeSupabase({ agents: { data: null, error: pgError("57014", "statement timeout") } });
  const err = await captureError<AppError>(() => new UsageRepository(db.client).getChatLimit(AGENT));
  assert.ok(err instanceof AppError);
});

Deno.test("UsageRepository: incrementUsage llama a la RPC con el asesor y el campo", async () => {
  const db = new FakeSupabase({}, {
    increment_monthly_usage: { data: { charge_id: "chg-1", chat_count: 1, ingestion_count: 0 }, error: null },
  });
  const res = await new UsageRepository(db.client).incrementUsage(AGENT, "chat");
  assert.equal(res.data?.charge_id, "chg-1");
  assert.deepEqual(db.rpcCalls, [{ fn: "increment_monthly_usage", args: { p_agent_id: AGENT, p_field: "chat" } }]);
});

Deno.test("UsageRepository: un fallo al devolver un cobro no tumba la petición", async () => {
  const db = new FakeSupabase({}, { refund_usage_charge: { data: null, error: pgError("42501", "not yours") } });
  const originalError = console.error;
  console.error = () => {};
  try {
    await new UsageRepository(db.client).refundCharge("chg-x");
  } finally {
    console.error = originalError;
  }
  assert.deepEqual(db.rpcCalls, [{ fn: "refund_usage_charge", args: { p_charge_id: "chg-x" } }]);
});
