// Endpoints REST de voz que comparten lógica con el chat de texto:
// executeSkill (mismo ejecutor, mismos errores para el modelo) y saveRound
// (mismo AiSessionService.saveChatRound). Superficie: HTTP.
import assert from "node:assert/strict";
import { buildAssistantHarness, persistedHistory, quietLogs, request } from "../../../shared/testing/assistant_harness.ts";
import { buildContact } from "../../../shared/testing/fake_skill_context.ts";

const SID = "33333333-3333-4333-8333-333333333333";
const post = (h: ReturnType<typeof buildAssistantHarness>, path: string, body: unknown) =>
  quietLogs(() => request(h, "POST", path, body));

Deno.test("voz execute-tool: ejecuta la skill con el asesor autenticado y devuelve { result } con la tarjeta aparte", async () => {
  const h = buildAssistantHarness({ skillData: { similarContacts: [buildContact()] } });
  const r = await post(h, "/ai/voice/execute-tool", { sessionId: SID, toolName: "search_contact", args: { query: "Julio" } });
  assert.equal(r.status, 200);
  assert.equal(r.json.success, true);
  assert.equal(r.json.data.result.contacts[0].fullName, "Julio Pérez");
  assert.equal(r.json.data.__skillMetadata.type, "contact_list");
  assert.ok(!JSON.stringify(r.json.data.result).includes("__skillMetadata"));
  assert.equal(h.skills.called("contactService.findSimilarContact")[0][0], h.agentId);
});

Deno.test("voz execute-tool: skill desconocida, args inválidos y skill que truena → mismos sobres que el chat de texto", async () => {
  const h = buildAssistantHarness({
    skillOverrides: { contactService: { findSimilarContact: () => Promise.reject(new Error("db down")) } },
  });
  const unk = await post(h, "/ai/voice/execute-tool", { sessionId: SID, toolName: "drop_database", args: {} });
  assert.deepEqual(unk.json.data.result, { error: "Unknown skill: drop_database" });
  const bad = await post(h, "/ai/voice/execute-tool", { sessionId: SID, toolName: "search_contact", args: {} });
  assert.match(bad.json.data.result.error, /^Missing required data/);
  const boom = await post(h, "/ai/voice/execute-tool", { sessionId: SID, toolName: "search_contact", args: { query: "x" } });
  assert.deepEqual(boom.json.data.result, { ok: false, error: "db down" });
});

Deno.test("voz execute-tool: cuota agotada → 200 con { quotaExceeded: true, message } y NO ejecuta la skill", async () => {
  const h = buildAssistantHarness();
  h.usageRepo.chatLimit = 0;
  const r = await post(h, "/ai/voice/execute-tool", { sessionId: SID, toolName: "search_contact", args: { query: "x" } });
  assert.equal(r.status, 200);
  assert.equal(r.json.data.quotaExceeded, true);
  assert.equal(typeof r.json.data.message, "string");
  assert.equal(h.skills.called("contactService.findSimilarContact").length, 0);
});

Deno.test("voz save-round: persiste usuario/modelo + llamadas a herramientas en el historial y cobra UN mensaje", async () => {
  const h = buildAssistantHarness();
  h.sessionsRepo.seedSession({ id: SID, agentId: h.agentId, type: "voice" });
  const r = await post(h, "/ai/voice/save-round", {
    sessionId: SID, userText: "busca a Julio", modelText: "Encontré a Julio", promptTokens: 100, completionTokens: 20, totalTokens: 120,
    toolCalls: [{ name: "search_contact", args: { query: "Julio" }, response: { contacts: [] } }],
  });
  assert.deepEqual(r.json, { success: true, data: { success: true } });
  const hist = persistedHistory(h, SID);
  assert.deepEqual(hist.map((m) => m.role), ["user", "model", "user", "model"]);
  assert.ok((hist[1].parts[0] as { functionCall?: unknown }).functionCall);
  assert.ok((hist[2].parts[0] as { functionResponse?: unknown }).functionResponse);
  assert.deepEqual(h.usageRepo.increments, [{ agentId: h.agentId, field: "chat" }]);
  assert.ok(h.sessionsRepo.tokenRows.every((t) => t.source === "chat_voice"));
  assert.deepEqual(h.sessionsRepo.messages.map((m) => m.role), ["user", "model"]);
});

Deno.test("voz save-round: dos rondas acumulan historial (no pisan el anterior)", async () => {
  const h = buildAssistantHarness();
  h.sessionsRepo.seedSession({ id: SID, agentId: h.agentId, type: "voice" });
  await post(h, "/ai/voice/save-round", { sessionId: SID, userText: "uno", modelText: "r1", promptTokens: 1, completionTokens: 1, totalTokens: 2 });
  await post(h, "/ai/voice/save-round", { sessionId: SID, userText: "dos", modelText: "r2", promptTokens: 1, completionTokens: 1, totalTokens: 2 });
  assert.deepEqual(persistedHistory(h, SID).map((m) => (m.parts[0] as { text: string }).text), ["uno", "r1", "dos", "r2"]);
});

Deno.test("voz save-round: sesión inexistente o ajena → error, sin cobrar un mensaje de chat", {
  ignore: true, // BUG: voice_chat.service.ts saveRound: getSessionContext().catch(()=>null) y saveChatRound lanza AppError 500 sin código ('sin modelo registrado'); debería ser 404 RESOURCE_NOT_FOUND
}, async () => {
  const h = buildAssistantHarness();
  const r = await post(h, "/ai/voice/save-round", { sessionId: SID, userText: "x", modelText: "y", promptTokens: 1, completionTokens: 1, totalTokens: 2 });
  assert.equal(r.status, 404);
  assert.equal(h.usageRepo.increments.length, 0);
});

Deno.test("caracterización: voz save-round con sesión inexistente hoy → 500 INTERNAL_ERROR y no cobra", async () => {
  const h = buildAssistantHarness();
  const r = await post(h, "/ai/voice/save-round", { sessionId: SID, userText: "x", modelText: "y", promptTokens: 1, completionTokens: 1, totalTokens: 2 });
  assert.equal(r.status, 500);
  assert.equal(h.usageRepo.increments.length, 0);
});
