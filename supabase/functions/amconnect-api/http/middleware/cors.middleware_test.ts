import assert from "node:assert/strict";
import { Hono } from "hono";
import { createCorsMiddleware } from "./cors.middleware.ts";
import { CORS_ALLOWED_ORIGINS } from "../../shared/security.config.ts";

function app(allowed: readonly string[]) {
  const a = new Hono();
  a.use("*", createCorsMiddleware(allowed));
  a.get("/x", (c) => c.text("ok"));
  return a;
}

const preflight = (origin: string) => ({
  method: "OPTIONS",
  headers: { Origin: origin, "Access-Control-Request-Method": "POST" },
});

Deno.test("cors: la lista de producción está vacía (D-027: aún no hay web)", () => {
  assert.deepEqual([...CORS_ALLOWED_ORIGINS], []);
});

Deno.test("cors: un origen listado sí recibe el header (para cuando exista la web)", async () => {
  const res = await app(["https://app.example"]).request("/x", preflight("https://app.example"));
  assert.equal(res.headers.get("Access-Control-Allow-Origin"), "https://app.example");
});

Deno.test("cors: un origen no listado no lo recibe, ni con la lista vacía", async () => {
  for (const allowed of [[], ["https://app.example"]]) {
    const res = await app(allowed).request("/x", preflight("https://evil.example"));
    assert.equal(res.status, 204);
    assert.equal(res.headers.get("Access-Control-Allow-Origin"), null);
  }
});

Deno.test("cors: nunca responde con comodín", async () => {
  const res = await app([]).request("/x", { headers: { Origin: "https://evil.example" } });
  assert.notEqual(res.headers.get("Access-Control-Allow-Origin"), "*");
});
