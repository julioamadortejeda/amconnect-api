import "../../shared/testing/test_env.ts";
import assert from "node:assert/strict";
import { type Context, Hono } from "hono";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createAuthMiddleware } from "./auth.middleware.ts";
import { globalErrorHandler } from "./error.middleware.ts";

const AGENT = "a1a1a1a1-0000-4000-8000-00000000000a";

type GetClaims = (token: string) => Promise<unknown>;

function app(getClaims: GetClaims) {
  const tokens: string[] = [];
  const client = {
    auth: {
      getClaims: (t: string) => {
        tokens.push(t);
        return getClaims(t);
      },
      getUser: () => {
        throw new Error("auth middleware must not call getUser directly");
      },
    },
  } as unknown as SupabaseClient;
  const a = new Hono();
  a.onError(globalErrorHandler);
  a.use("*", createAuthMiddleware(() => client));
  a.get("/x", (c: Context) => c.json({ agent: c.get("agent_id") }));
  return { a, tokens };
}

const claims = (extra: Record<string, unknown> = {}) =>
  Promise.resolve({ data: { claims: { sub: AGENT, role: "authenticated", exp: 9999999999, ...extra } }, error: null });

const bearer = (t = "tok") => ({ headers: { Authorization: `Bearer ${t}` } });

Deno.test("auth: token válido → agent_id del claim sub, verificado con getClaims(token)", async () => {
  const { a, tokens } = app(() => claims());
  const res = await a.request("/x", bearer("abc"));
  assert.equal(res.status, 200);
  assert.deepEqual(await res.json(), { agent: AGENT });
  assert.deepEqual(tokens, ["abc"]);
});

Deno.test("auth: sin header o sin Bearer → 401 SESSION_EXPIRED", async () => {
  const { a, tokens } = app(() => claims());
  for (const init of [{}, { headers: { Authorization: "Basic x" } }, { headers: { Authorization: "Bearer " } }]) {
    const res = await a.request("/x", init);
    assert.equal(res.status, 401);
    assert.equal((await res.json()).errorCode, "SESSION_EXPIRED");
  }
  assert.equal(tokens.length, 0);
});

Deno.test("auth: getClaims con error (firma inválida, expirado) → 401", async () => {
  const { a } = app(() => Promise.resolve({ data: null, error: { message: "JWT has expired" } }));
  const res = await a.request("/x", bearer());
  assert.equal(res.status, 401);
});

Deno.test("auth: getClaims que lanza (alg desconocido) → 401, no 500", async () => {
  const { a } = app(() => Promise.reject(new Error("Invalid alg claim")));
  const res = await a.request("/x", bearer());
  assert.equal(res.status, 401);
});

Deno.test("auth: tokens que no son de un asesor → 401", async () => {
  const bad: Record<string, unknown>[] = [
    { role: "anon" },
    { role: "service_role" },
    { sub: undefined },
    { sub: "not-a-uuid" },
    { is_anonymous: true },
  ];
  for (const extra of bad) {
    const { a } = app(() => claims(extra));
    const res = await a.request("/x", bearer());
    assert.equal(res.status, 401, JSON.stringify(extra));
  }
});
