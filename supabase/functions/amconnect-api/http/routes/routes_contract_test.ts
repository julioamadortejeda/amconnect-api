// Contrato de las rutas reales: params/query inválidos → 422 VALIDATION_FAILED
// antes de tocar un service (antes eran un error de BD o un 500), y los listados
// responden con la forma única de paginación.
import "../../shared/testing/test_env.ts";
import assert from "node:assert/strict";
import { FakeSupabase } from "../../shared/testing/fake_supabase.ts";
import { call, createTestApp } from "../../shared/testing/test_app.ts";
import { apiRouter } from "./index.ts";

const UUID = "11111111-1111-4111-8111-111111111111";

function app(services: Record<string, unknown> = {}) {
  return createTestApp({
    supabase: new FakeSupabase().client,
    context: { services },
    routes: (r) => r.route("/", apiRouter),
  });
}

Deno.test("params: un id que no es uuid es 422 VALIDATION_FAILED en toda ruta con :id", async () => {
  const routes: Array<[string, string]> = [
    ["GET", "/contacts/no-es-uuid"],
    ["GET", "/contacts/no-es-uuid/notes"],
    ["PATCH", "/contacts/no-es-uuid"],
    ["DELETE", "/contacts/no-es-uuid"],
    ["GET", "/contacts/no-es-uuid/policies"],
    ["GET", "/policies/no-es-uuid"],
    ["PATCH", "/policies/no-es-uuid"],
    ["DELETE", "/policies/no-es-uuid"],
    ["GET", "/policies/no-es-uuid/notes"],
    ["POST", "/policies/no-es-uuid/notes"],
    ["DELETE", "/notes/no-es-uuid"],
    ["GET", "/reminders/no-es-uuid"],
    ["PATCH", "/reminders/no-es-uuid"],
    ["PATCH", "/reminders/no-es-uuid/done"],
    ["DELETE", "/reminders/no-es-uuid"],
    ["GET", "/reminders/no-es-uuid/notes"],
    ["PATCH", "/commitments/no-es-uuid/close"],
    ["GET", "/catalog/carriers/no-es-uuid"],
    ["PATCH", "/catalog/branches/no-es-uuid"],
    ["DELETE", "/catalog/products/no-es-uuid"],
    ["POST", "/ai/sessions/no-es-uuid/cancel"],
    ["POST", "/ai/sessions/no-es-uuid/resolve-contact-mismatch"],
    ["GET", "/ai/sessions/no-es-uuid/cost"],
    ["DELETE", `/reminders/settings/PAYMENT/branches/no-es-uuid`],
  ];
  const a = app();
  for (const [method, path] of routes) {
    const { status, json } = await call(a, method, path, method === "GET" || method === "DELETE" ? undefined : {});
    assert.equal(status, 422, `${method} ${path}`);
    assert.equal(json.success, false, `${method} ${path}`);
    assert.equal(json.errorCode, "VALIDATION_FAILED", `${method} ${path}`);
  }
});

Deno.test("query: basura en page/pageSize/filtros es 422", async () => {
  const a = app();
  for (const path of [
    "/contacts?page=abc",
    "/contacts?pageSize=0",
    "/policies?page=-2",
    "/contacts/" + UUID + "/notes?pageSize=x",
    "/contacts/" + UUID + "/policies?page=0",
    "/reminders?policyId=nope",
    "/commitments?contactId=nope",
    "/commitments?from=ayer",
    "/commitments?overdueOnly=quizas",
    "/notes/search?page=0",
    "/ai/upload-url",
  ]) {
    const { status, json } = await call(a, "GET", path);
    assert.equal(status, 422, path);
    assert.equal(json.errorCode, "VALIDATION_FAILED", path);
  }
});

Deno.test("commitments: lista paginada con la forma única y filtros parseados", async () => {
  const seen: unknown[] = [];
  const commitmentService = {
    listPage: (agentId: string, filters: unknown, page: number, pageSize: number) => {
      seen.push({ agentId, filters, page, pageSize });
      return Promise.resolve({ data: [{ id: "c1" }], total: 41, page, pageSize, hasMore: true });
    },
  };
  const { status, json } = await call(
    app({ commitmentService }),
    "GET",
    `/commitments?page=2&pageSize=500&contactId=${UUID}&from=2026-11-01&overdueOnly=true&query=%20poliza%20`,
  );
  assert.equal(status, 200);
  assert.deepEqual(json, { success: true, data: { data: [{ id: "c1" }], total: 41, page: 2, pageSize: 100, hasMore: true } });
  assert.deepEqual(seen[0], {
    agentId: "a1a1a1a1-0000-4000-8000-00000000000a",
    filters: { from: "2026-11-01", contactId: UUID, overdueOnly: true, query: "poliza" },
    page: 2,
    pageSize: 100,
  });
});

Deno.test("contacts/:id/policies: pagina con el mismo contrato y filtra por el contacto", async () => {
  const calls: unknown[][] = [];
  const policyService = {
    paginate: (...args: unknown[]) => {
      calls.push(args);
      return Promise.resolve({ data: [], total: 0, page: 1, pageSize: 20, hasMore: false });
    },
  };
  const { status, json } = await call(app({ policyService }), "GET", `/contacts/${UUID}/policies`);
  assert.equal(status, 200);
  assert.deepEqual(calls[0], [{ contact_id: UUID }, 1, 20]);
  assert.deepEqual(Object.keys(json.data as object).sort(), ["data", "hasMore", "page", "pageSize", "total"]);
});

Deno.test("notas de contacto/póliza/recordatorio: misma forma de paginación", async () => {
  const noteService = {
    getByContactId: (id: string, page: number, size: number) => Promise.resolve({ data: [{ id }], total: 1, page, pageSize: size, hasMore: false }),
    getByPolicyId: (id: string, page: number, size: number) => Promise.resolve({ data: [{ id }], total: 1, page, pageSize: size, hasMore: false }),
    getByReminderId: (id: string, page: number, size: number) => Promise.resolve({ data: [{ id }], total: 1, page, pageSize: size, hasMore: false }),
  };
  for (const path of [`/contacts/${UUID}/notes`, `/policies/${UUID}/notes`, `/reminders/${UUID}/notes`]) {
    const { status, json } = await call(app({ noteService }), "GET", `${path}?page=1&pageSize=10`);
    assert.equal(status, 200, path);
    assert.deepEqual(json, { success: true, data: { data: [{ id: UUID }], total: 1, page: 1, pageSize: 10, hasMore: false } }, path);
  }
});

Deno.test("health: también usa { success, data }", async () => {
  // El health vive en index.ts (antes de auth); aquí solo se comprueba el helper que usa.
  const { sendSuccess } = await import("../../shared/api_response.ts");
  const { Hono } = await import("hono");
  const h = new Hono();
  h.get("/h", (c) => sendSuccess(c, { status: "ok" }));
  const res = await h.request("/h");
  assert.deepEqual(await res.json(), { success: true, data: { status: "ok" } });
});
