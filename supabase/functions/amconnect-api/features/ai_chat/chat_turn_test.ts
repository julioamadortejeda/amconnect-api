// Piezas de un turno del chat (chat_turn.ts, rag_attachments.ts) y un turno
// completo de AiChatService.processMessage con proveedor y sesión falsos:
// bloque [CONTEXT], vuelta de herramientas, citación y attachment_list.
//
// test_env va primero: el registro de skills importa módulos que leen config.
import "../../shared/testing/test_env.ts";
import assert from "node:assert/strict";
import { AiRole, type AiMessage, type IAiProvider } from "../../core/ai_provider.interface.ts";
import { buildContextPrefix, collectAdvisorWords, lastReplyLanguage, resolveChatDomains } from "./chat_turn.ts";
import { extractCitations, RagAttachmentCollector } from "./rag_attachments.ts";
import { AiChatService } from "./ai_chat.service.ts";
import type { AiSessionService } from "./ai_session.service.ts";
import type { PromptService } from "../../modules/prompt/prompt.service.ts";
import type { SkillServices } from "./skills/skill.core.ts";
import { fakeSkillContext, quiet } from "../../shared/testing/fake_skill_context.ts";

const NOTE_A = "11111111-1111-4111-8111-111111111111";
const NOTE_B = "22222222-2222-4222-8222-222222222222";

// ─── Dominios ───────────────────────────────────────────────────────────────

Deno.test("resolveChatDomains: clasificador vacío ⇒ todos + siempre activos", () => {
  const domains = resolveChatDomains([]);
  for (const d of ["contact", "policy", "reminder", "commitment", "pending_task", "catalog", "knowledge"]) {
    assert.ok(domains.includes(d), d);
  }
});

Deno.test("resolveChatDomains: policy ⇒ catalog; reminder ⇄ commitment; pantalla fuerza su dominio", () => {
  assert.deepEqual(resolveChatDomains(["policy"]), ["pending_task", "knowledge", "policy", "catalog"]);
  assert.deepEqual(resolveChatDomains(["reminder"]), ["pending_task", "knowledge", "reminder", "commitment"]);
  assert.deepEqual(resolveChatDomains(["commitment"]), ["pending_task", "knowledge", "commitment", "reminder"]);
  assert.deepEqual(
    resolveChatDomains(["contact"], { type: "policy", id: null, data: {} }),
    ["pending_task", "knowledge", "contact", "policy", "catalog"],
  );
});

Deno.test("resolveChatDomains: no muta el arreglo del clasificador", () => {
  const classified = ["policy"];
  resolveChatDomains(classified);
  assert.deepEqual(classified, ["policy"]);
});

// ─── [CONTEXT] e historial ──────────────────────────────────────────────────

Deno.test("buildContextPrefix: fecha, idioma, tareas pendientes y pantalla", () => {
  const prefix = buildContextPrefix({
    localIso: "2026-11-20T10:00:00-06:00",
    offsetStr: "-06:00",
    replyLanguage: "Spanish",
    pendingTasks: [{ id: "t-1", taskType: "disambiguation", payload: { a: 1 } }],
    context: { type: "contact", id: "c-1", data: { fullName: "Rosa" } },
  });
  assert.equal(
    prefix,
    "[CONTEXT] Current date/time: 2026-11-20T10:00:00-06:00 | Timezone offset: -06:00 | Reply language: Spanish\n" +
      "Active pending tasks requiring resolution:\n- ID: t-1, tipo: disambiguation, datos: {\"a\":1}\n" +
      "Active screen context (contact ID: c-1):\n{\n  \"fullName\": \"Rosa\"\n}\n\n",
  );
});

Deno.test("lastReplyLanguage y collectAdvisorWords leen el historial sin el bloque [CONTEXT]", () => {
  const history: AiMessage[] = [
    { role: AiRole.USER, parts: [{ text: "[CONTEXT] x | Reply language: English\n\nhello" }] },
    { role: AiRole.MODEL, parts: [{ text: "hi" }] },
    { role: AiRole.USER, parts: [{ text: "[CONTEXT] y | Reply language: Spanish\n\nel segundo" }] },
  ];
  assert.equal(lastReplyLanguage(history), "Spanish");
  assert.equal(collectAdvisorWords(history), "hello\nel segundo");
});

// ─── Citación y adjuntos ────────────────────────────────────────────────────

Deno.test("extractCitations: limpia los marcadores y junta los ids", () => {
  const { displayText, citedNoteIds } = extractCitations(`Su mamá tiene diabetes [[cite:${NOTE_A}]].`);
  assert.equal(displayText, "Su mamá tiene diabetes.");
  assert.deepEqual([...citedNoteIds], [NOTE_A]);
});

Deno.test("RagAttachmentCollector: relevancia relativa, dedupe y filtro por citación", () => {
  const collector = new RagAttachmentCollector();
  const { emptyRagSearch } = collector.harvest("search_knowledge", [
    { noteId: NOTE_A, similarity: 0.8, storagePath: "a.pdf", fileName: "A" },
    { noteId: NOTE_A, similarity: 0.79, storagePath: "a.pdf", fileName: "A" },
    { noteId: NOTE_B, similarity: 0.6, storagePath: "b.pdf", fileName: "B" }, // fuera del margen 0.15
  ]);
  assert.equal(emptyRagSearch, false);
  assert.deepEqual(collector.buildAttachmentList(new Set())?.attachments.map((a) => a.id), [NOTE_A]);
  assert.equal(collector.buildAttachmentList(new Set([NOTE_B])), undefined);
  assert.equal(collector.harvest("search_knowledge", []).emptyRagSearch, true);
  assert.equal(collector.harvest("search_contact", []).emptyRagSearch, false);
});

// ─── Turno completo ─────────────────────────────────────────────────────────

function fakeProvider(script: Array<Record<string, unknown>>) {
  const interactions: Array<{ input: unknown; forceTextOnly?: boolean }> = [];
  const provider = {
    model: "test-text-model",
    classifyMessage: () => Promise.resolve({ domains: ["contact"], usage: { promptTokens: 1, completionTokens: 1, totalTokens: 2 }, language: "Spanish" }),
    processInteraction: (input: unknown, _tools: unknown, _sys: unknown, _prev: unknown, _history: unknown, forceTextOnly?: boolean) => {
      interactions.push({ input, forceTextOnly });
      return Promise.resolve(script.shift() ?? { text: "" });
    },
  } as unknown as IAiProvider;
  return { provider, interactions };
}

function fakeSession() {
  const saved: unknown[][] = [];
  const service = {
    createSession: () => Promise.resolve("session-1"),
    getSessionContext: () => Promise.resolve(null),
    getActivePendingTasks: () => Promise.resolve([]),
    saveChatRound: (...args: unknown[]) => {
      saved.push(args);
      return Promise.resolve({ promptTokens: 0, completionTokens: 0, totalTokens: 0 });
    },
    markSessionProviderError: () => Promise.resolve(),
  } as unknown as AiSessionService;
  return { service, saved };
}

Deno.test("processMessage: herramienta RAG → texto citado → attachment_list solo con lo citado", async () => {
  const { ctx } = fakeSkillContext();
  // deno-lint-ignore no-explicit-any
  (ctx.ragService as any).searchNotes = () =>
    Promise.resolve([
      { noteId: NOTE_A, similarity: 0.7, storagePath: "a.pdf", fileName: "A.pdf", sourceType: "document", content: "a" },
      { noteId: NOTE_B, similarity: 0.65, storagePath: "b.pdf", fileName: "B.pdf", sourceType: "document", content: "b" },
    ]);
  const { provider, interactions } = fakeProvider([
    {
      functionCalls: [{ name: "search_knowledge", args: { query: "mamá de Rosa" } }],
      rawModelParts: [{ functionCall: { id: "call-1", name: "search_knowledge", args: { query: "mamá de Rosa" } } }],
      usage: { promptTokens: 10, completionTokens: 2, totalTokens: 12 },
      interactionId: "i-1",
    },
    {
      text: `Su mamá tiene diabetes [[cite:${NOTE_A}]].`,
      usage: { promptTokens: 20, completionTokens: 5, totalTokens: 25, cachedTokens: 8 },
      interactionId: "i-2",
    },
  ]);
  const session = fakeSession();
  const prompts = { getPrompt: () => Promise.resolve("SYSTEM") } as unknown as PromptService;
  const service = new AiChatService(provider, ctx as unknown as SkillServices, session.service, prompts);

  const result = await quiet(() => service.processMessage("¿qué me dijo Rosa de su mamá?", "agent-1", null, "America/Mexico_City"));

  assert.equal(result.text, "Su mamá tiene diabetes.");
  assert.equal(result.sessionId, "session-1");
  assert.deepEqual(result.usage, { promptTokens: 31, completionTokens: 8, totalTokens: 39, cachedTokens: 8 });
  assert.deepEqual(result.metadata, {
    type: "attachment_list",
    attachments: [{ id: NOTE_A, fileName: "A.pdf", storagePath: "a.pdf", sourceType: "document", summary: "a" }],
  });

  // Primer turno: el [CONTEXT] va antepuesto al mensaje.
  assert.match(String(interactions[0].input), /^\[CONTEXT\] Current date\/time: .* \| Reply language: Spanish\n\n¿qué me dijo Rosa/);
  // Segundo turno: el resultado de la skill viaja como function_result con el id de la llamada.
  const steps = interactions[1].input as Array<Record<string, unknown>>;
  assert.equal(steps[0].type, "function_result");
  assert.equal(steps[0].call_id, "call-1");
  assert.equal(steps[0].name, "search_knowledge");
  assert.equal(interactions[1].forceTextOnly, false);
  assert.equal(session.saved.length, 1);
});

Deno.test("processMessage: RAG vacío fuerza texto en el turno siguiente", async () => {
  const { ctx } = fakeSkillContext();
  const { provider, interactions } = fakeProvider([
    {
      functionCalls: [{ name: "search_knowledge", args: { query: "x" } }],
      rawModelParts: [{ functionCall: { id: "call-1", name: "search_knowledge", args: { query: "x" } } }],
    },
    { text: "No encontré nada." },
  ]);
  const session = fakeSession();
  const prompts = { getPrompt: () => Promise.resolve("SYSTEM") } as unknown as PromptService;
  const service = new AiChatService(provider, ctx as unknown as SkillServices, session.service, prompts);
  const result = await quiet(() => service.processMessage("¿subí algún currículum?", "agent-1"));
  assert.equal(result.text, "No encontré nada.");
  assert.equal(interactions[1].forceTextOnly, true);
  assert.equal(result.metadata, undefined);
});
