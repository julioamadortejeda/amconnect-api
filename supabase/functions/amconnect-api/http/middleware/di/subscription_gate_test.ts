// La puerta del 402: `injectServices` (el middleware REAL del DI) con un
// cliente Supabase falso. Prueba que las rutas de SUBSCRIPTION_EXEMPT_ROUTES
// responden con la suscripción vencida y que cualquier otra devuelve 402.
//
// test_env va primero: config.ts exige GEMINI_MODEL al cargarse.
import "../../../shared/testing/test_env.ts";
import assert from "node:assert/strict";
import type { Context } from "hono";
import { injectServices } from "./index.ts";
import { FakeSupabase, type RecordedQuery } from "../../../shared/testing/fake_supabase.ts";
import { call, createTestApp } from "../../../shared/testing/test_app.ts";
import { daysFromNow } from "../../../shared/testing/fakes.ts";

// Espejo de la lista del DI. Si se agrega una exenta allá, agréguese aquí.
const EXEMPT: Array<[string, string]> = [
  ["GET", "/agents/me"],
  ["DELETE", "/agents/device-tokens"],
  ["GET", "/subscription"],
  ["GET", "/subscription/plans"],
  ["POST", "/subscription/apply-promo"],
];

const PROTECTED: Array<[string, string]> = [
  ["GET", "/contacts"],
  ["POST", "/ai/chat"],
  ["POST", "/agents/device-tokens"], // mismo path que una exenta, otro método
  ["PATCH", "/agents/me"],
];

function fakeDb(agent: { subscription_status: string; trial_ends_at: string | null } | null) {
  return new FakeSupabase({
    // checkModelCatalog: todos los modelos pedidos existen y están activos.
    ai_models: (q: RecordedQuery) => ({
      data: ((q.args("in")?.[1] as string[]) ?? []).map((m) => ({ model_name: m })),
      error: null,
    }),
    agents: { data: agent && { ...agent, timezone: null, locale: null }, error: null },
  });
}

function appFor(db: FakeSupabase) {
  const ok = (c: Context) => c.json({ success: true });
  return createTestApp({
    supabase: db.client,
    middleware: [injectServices],
    routes: (r) => {
      for (const [method, path] of [...EXEMPT, ...PROTECTED]) r.on(method, path, ok);
    },
  });
}

for (const [method, path] of EXEMPT) {
  Deno.test(`402: ${method} ${path} responde con la suscripción vencida (exenta)`, async () => {
    const app = appFor(fakeDb({ subscription_status: "expired", trial_ends_at: null }));
    const { status } = await call(app, method, path);
    assert.equal(status, 200);
  });
}

for (const [method, path] of PROTECTED) {
  Deno.test(`402: ${method} ${path} con la suscripción vencida → 402 SUBSCRIPTION_REQUIRED`, async () => {
    const db = fakeDb({ subscription_status: "expired", trial_ends_at: null });
    const { status, json } = await call(appFor(db), method, path);
    assert.equal(status, 402);
    assert.equal(json.success, false);
    assert.equal(json.errorCode, "SUBSCRIPTION_REQUIRED");
    assert.equal(db.queriesTo("error_logs").length, 1, "el 402 se registra en error_logs");
  });
}

Deno.test("402: trial vencido por fecha bloquea una ruta normal pero no las exentas", async () => {
  const db = fakeDb({ subscription_status: "trial", trial_ends_at: daysFromNow(-1) });
  const app = appFor(db);
  const blocked = await call(app, "POST", "/ai/chat");
  assert.equal(blocked.status, 402);
  assert.match(String(blocked.json.error), /período de prueba/);
  assert.equal((await call(app, "GET", "/subscription")).status, 200);
});

Deno.test("402: trial vigente y activo pasan a cualquier ruta", async () => {
  for (const agent of [
    { subscription_status: "trial", trial_ends_at: daysFromNow(5) },
    { subscription_status: "active", trial_ends_at: null },
  ]) {
    const { status } = await call(appFor(fakeDb(agent)), "GET", "/contacts");
    assert.equal(status, 200, agent.subscription_status);
  }
});

Deno.test("402: cancelada también bloquea (no solo expired)", async () => {
  const { status } = await call(appFor(fakeDb({ subscription_status: "cancelled", trial_ends_at: null })), "GET", "/contacts");
  assert.equal(status, 402);
});

Deno.test("402: asesor sin perfil → 404 RESOURCE_NOT_FOUND, también en rutas exentas", async () => {
  const { status, json } = await call(appFor(fakeDb(null)), "GET", "/agents/me");
  assert.equal(status, 404);
  assert.equal(json.errorCode, "RESOURCE_NOT_FOUND");
});
