// D-024 en el middleware REAL: el header Accept-Language solo llena el vacío.
import "../../../shared/testing/test_env.ts";
import assert from "node:assert/strict";
import type { Context } from "hono";
import { injectServices } from "./index.ts";
import { FakeSupabase, type RecordedQuery } from "../../../shared/testing/fake_supabase.ts";
import { BASE_PATH, createTestApp } from "../../../shared/testing/test_app.ts";
import { daysFromNow } from "../../../shared/testing/fakes.ts";

async function run(stored: string | null, header: string | undefined) {
  const db = new FakeSupabase({
    ai_models: (q: RecordedQuery) => ({
      data: ((q.args("in")?.[1] as string[]) ?? []).map((m) => ({ model_name: m })),
      error: null,
    }),
    agents: {
      data: { subscription_status: "active", trial_ends_at: daysFromNow(10), timezone: null, locale: stored },
      error: null,
    },
  });
  const app = createTestApp({
    supabase: db.client,
    middleware: [injectServices],
    routes: (r) => {
      r.get("/ping", (c: Context) => c.json({ success: true }));
    },
  });
  const res = await app.request(`${BASE_PATH}/ping`, { headers: header ? { "Accept-Language": header } : {} });
  assert.equal(res.status, 200);
  await new Promise((r) => setTimeout(r, 0)); // el sync es fire-and-forget
  return db.queriesTo("agents").filter((q) => q.has("update"));
}

Deno.test("locale: null + en-US → escribe 'en'", async () => {
  const writes = await run(null, "en-US");
  assert.equal(writes.length, 1);
  assert.deepEqual(writes[0].args("update"), [{ locale: "en" }]);
});

Deno.test("locale: 'en_US' legado + es-MX → escribe 'es'", async () => {
  const writes = await run("en_US", "es-MX");
  assert.deepEqual(writes[0].args("update"), [{ locale: "es" }]);
});

Deno.test("locale: 'es' guardado + teléfono en en-US → no escribe", async () => {
  assert.equal((await run("es", "en-US")).length, 0);
});

Deno.test("locale: sin header → no escribe", async () => {
  assert.equal((await run(null, undefined)).length, 0);
});
