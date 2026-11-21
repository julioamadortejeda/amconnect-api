// Los endpoints de voz responden con el mismo sobre { success, data } que el resto.
import "../../shared/testing/test_env.ts";
import assert from "node:assert/strict";
import { FakeSupabase } from "../../shared/testing/fake_supabase.ts";
import { call, createTestApp } from "../../shared/testing/test_app.ts";
import { apiRouter } from "../routes/index.ts";

function app(quotaOk = true) {
  const voiceChatService = {
    createEphemeralToken: () => Promise.resolve({ token: "t", url: "wss://x", model: "m" }),
    initSession: () => Promise.resolve({ sessionId: "s1", systemInstruction: "si", tools: [], dynamicContext: "" }),
    executeTool: () => Promise.resolve({ result: { ok: true } }),
    saveRound: () => Promise.resolve({ saved: true }),
  };
  const usage_service = {
    checkChatQuotaOnly: () => quotaOk ? Promise.resolve() : Promise.reject(new Error("Sin cuota")),
  };
  return createTestApp({
    supabase: new FakeSupabase().client,
    context: { services: { voiceChatService }, usage_service },
    routes: (r) => r.route("/", apiRouter),
  });
}

Deno.test("voz: token, init, init-session, execute-tool y save-round van dentro de data", async () => {
  const a = app();
  const token = await call(a, "POST", "/ai/voice/token", {});
  assert.equal(token.json.success, true);
  assert.equal((token.json.data as Record<string, unknown>).token, "t");
  assert.equal(token.json.token, undefined, "nada suelto fuera de data");

  const init = await call(a, "POST", "/ai/voice/init", {});
  assert.equal((init.json.data as Record<string, unknown>).sessionId, "s1");

  const both = await call(a, "POST", "/ai/voice/init-session", {});
  const bothData = both.json.data as Record<string, unknown>;
  assert.equal(bothData.sessionId, "s1");
  assert.equal(bothData.token, "t");

  const exec = await call(a, "POST", "/ai/voice/execute-tool", { sessionId: "s1", toolName: "x", args: {} });
  assert.deepEqual(exec.json, { success: true, data: { result: { ok: true } } });

  const round = await call(a, "POST", "/ai/voice/save-round", { sessionId: "s1" });
  assert.deepEqual(round.json, { success: true, data: { saved: true } });
});

Deno.test("voz: sin cuota, execute-tool sigue siendo 200 con la bandera dentro de data", async () => {
  const { status, json } = await call(app(false), "POST", "/ai/voice/execute-tool", { sessionId: "s1", toolName: "x", args: {} });
  assert.equal(status, 200);
  assert.deepEqual(json, { success: true, data: { quotaExceeded: true, message: "Sin cuota" } });
});
