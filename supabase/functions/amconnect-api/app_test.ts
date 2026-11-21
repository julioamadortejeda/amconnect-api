// Orden real de middleware (app.ts): CORS → rutas públicas → auth → límite por
// minuto → DI → router. Auth y DI se reemplazan por fakes; el límite y el
// manejador de errores son los reales.
import "./shared/testing/test_env.ts";
import assert from "node:assert/strict";
import type { Context, Next } from "hono";
import { createApp } from "./app.ts";
import { FakeSupabase, pgError, type QueryResult } from "./shared/testing/fake_supabase.ts";
import { TEST_AGENT_ID } from "./shared/testing/test_app.ts";

function setup(rpc: QueryResult) {
  const fake = new FakeSupabase({}, { consume_rate_limit: rpc });
  let reachedDi = 0;
  const app = createApp({
    authMiddleware: async (c: Context, next: Next) => {
      c.set("agent_id", TEST_AGENT_ID);
      c.set("supabase", fake.client);
      await next();
    },
    // El DI real consulta la BD; aquí solo se registra que se llegó.
    injectServices: (c: Context) => {
      reachedDi++;
      return Promise.resolve(c.json({ success: true, data: "reached" }));
    },
  });
  return { app, fake, reached: () => reachedDi };
}

const DENY: QueryResult = { data: { allowed: false, remaining: 0, retryAfterSeconds: 23 }, error: null };
const ALLOW: QueryResult = { data: { allowed: true, remaining: 10, retryAfterSeconds: 0 }, error: null };

Deno.test("límite: rebasado → 429 RATE_LIMITED con Retry-After y sin tocar el DI", async () => {
  const { app, fake, reached } = setup(DENY);
  const res = await app.request("/amconnect-api/ai/chat", { method: "POST" });
  assert.equal(res.status, 429);
  assert.equal(res.headers.get("Retry-After"), "23");
  const body = await res.json();
  assert.equal(body.success, false);
  assert.equal(body.errorCode, "RATE_LIMITED");
  assert.equal(typeof body.error, "string");
  assert.equal(reached(), 0);
  assert.equal(fake.rpcCalls[0].args.p_bucket, "ai");
  assert.equal(fake.queriesTo("error_logs").length, 0, "un 429 del límite no se persiste");
});

Deno.test("límite: dentro del cupo pasa al DI con una sola RPC", async () => {
  const { app, fake, reached } = setup(ALLOW);
  const res = await app.request("/amconnect-api/contacts");
  assert.equal(res.status, 200);
  assert.equal(reached(), 1);
  assert.equal(fake.rpcCalls.length, 1);
  assert.equal(fake.rpcCalls[0].args.p_bucket, "general");
});

Deno.test("límite: si el contador falla, la petición pasa (fail-open)", async () => {
  const { app, reached } = setup({ data: null, error: pgError("08006") });
  const original = console.error;
  console.error = () => {};
  try {
    const res = await app.request("/amconnect-api/contacts");
    assert.equal(res.status, 200);
  } finally {
    console.error = original;
  }
  assert.equal(reached(), 1);
});

Deno.test("exentas: /health, /openapi.json y el cron no consumen cupo", async () => {
  const { app, fake } = setup(DENY);
  assert.equal((await app.request("/amconnect-api/health")).status, 200);
  assert.equal((await app.request("/amconnect-api/openapi.json")).status, 200);
  const cron1 = await app.request("/amconnect-api/notifications/send-due", { method: "POST" });
  const cron2 = await app.request("/amconnect-api/reminders/generate-due", { method: "POST" });
  assert.notEqual(cron1.status, 429);
  assert.notEqual(cron2.status, 429);
  await cron1.body?.cancel();
  await cron2.body?.cancel();
  assert.equal(fake.rpcCalls.length, 0);
});

Deno.test("CORS: preflight de un origen no listado no recibe Access-Control-Allow-Origin", async () => {
  const { app, fake } = setup(ALLOW);
  const res = await app.request("/amconnect-api/contacts", {
    method: "OPTIONS",
    headers: { Origin: "https://evil.example", "Access-Control-Request-Method": "POST" },
  });
  assert.equal(res.status, 204, "el preflight se contesta sin llegar a auth (y sin 500)");
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), null);
  assert.equal(fake.rpcCalls.length, 0, "el preflight no gasta cupo");
});

Deno.test("CORS: GET con Origin no listado tampoco recibe Access-Control-Allow-Origin", async () => {
  const { app } = setup(ALLOW);
  const res = await app.request("/amconnect-api/health", { headers: { Origin: "https://evil.example" } });
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), null);
});

Deno.test("CORS: cliente sin Origin (app móvil, curl) funciona igual", async () => {
  const { app } = setup(ALLOW);
  const res = await app.request("/amconnect-api/health");
  assert.equal(res.status, 200);
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), null);
});
