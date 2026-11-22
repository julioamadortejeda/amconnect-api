// Bucle de herramientas del chat: texto, una/varias/paralelas herramientas, tope
// de vueltas, herramientas desconocidas / que truenan / con args inválidos,
// respuesta vacía y errores del proveedor. Superficie: POST /ai/chat.
import assert from "node:assert/strict";
import {
  buildAssistantHarness,
  callTool,
  callTools,
  persistedHistory,
  postChat,
  quietLogs,
  say,
  usage,
} from "../../../shared/testing/assistant_harness.ts";
import { buildContact } from "../../../shared/testing/fake_skill_context.ts";
import { AiError, AiProviderError } from "../../../shared/errors.ts";

const chat = (h: ReturnType<typeof buildAssistantHarness>, message = "hola", extra: Record<string, unknown> = {}) =>
  quietLogs(() => postChat(h, { message, ...extra }));

Deno.test("texto simple: sobre { success, data: { text, sessionId, usage, aiBackend } }", async () => {
  const h = buildAssistantHarness({ script: [say("Hola, soy tu asistente.", usage(100, 20))] });
  const { status, json } = await chat(h);
  assert.equal(status, 200);
  assert.equal(json.success, true);
  assert.equal(json.data.text, "Hola, soy tu asistente.");
  assert.match(json.data.sessionId, /^[0-9a-f-]{36}$/);
  assert.equal(typeof json.data.usage.promptTokens, "number");
  assert.equal(typeof json.data.usage.completionTokens, "number");
  assert.equal(typeof json.data.usage.totalTokens, "number");
  assert.ok(["studio", "vertex"].includes(json.data.aiBackend));
  assert.ok(json.data.sessionUsage, "viaja el acumulado de la sesión");
  assert.equal(h.provider.calls, 1, "sin herramientas: una sola llamada al modelo");
});

Deno.test("una herramienta: modelo pide → resultado vuelve al modelo → texto final", async () => {
  const h = buildAssistantHarness({
    script: [callTool("search_contact", { query: "Julio" }), say("Encontré a Julio Pérez.")],
    skillData: { similarContacts: [buildContact()] },
  });
  const { json } = await chat(h, "busca a Julio");
  assert.equal(json.data.text, "Encontré a Julio Pérez.");
  assert.equal(h.provider.calls, 2);
  assert.deepEqual(h.skills.called("contactService.findSimilarContact").map((a) => a[1]), ["Julio"]);
  // El segundo turno manda el resultado de la herramienta como function_result.
  const second = h.provider.interactions[1].input as Record<string, unknown>[];
  assert.equal(second[0].type, "function_result");
  assert.equal(second[0].name, "search_contact");
  assert.match(JSON.stringify(second[0].result), /Julio/);
});

Deno.test("la herramienta se ejecuta con el agente autenticado y la sesión del turno", async () => {
  const h = buildAssistantHarness({
    script: [callTool("search_contact", { query: "x" }), say("ok")],
  });
  const { json } = await chat(h);
  assert.ok(json.success);
  assert.equal(h.skills.called("contactService.findSimilarContact")[0][0], h.agentId);
});

Deno.test("bucle de 3 herramientas encadenadas: usage sumado y cada resultado alimenta el turno siguiente", async () => {
  const h = buildAssistantHarness({
    script: [
      callTool("search_contact", { query: "a" }, usage(100, 10, 50)),
      callTool("get_contact", { contact_id: "c-1" }, usage(120, 11, 60)),
      callTool("count_contacts", {}, usage(140, 12, 70)),
      say("listo", usage(160, 13, 80)),
    ],
    classify: { domains: ["contact"], language: "Spanish", usage: usage(30, 2) },
    skillData: { similarContacts: [buildContact()], contactById: buildContact() },
  });
  const { json } = await chat(h);
  assert.equal(h.provider.calls, 4);
  assert.equal(json.data.text, "listo");
  assert.equal(json.data.usage.promptTokens, 30 + 100 + 120 + 140 + 160);
  assert.equal(json.data.usage.completionTokens, 2 + 10 + 11 + 12 + 13);
  assert.equal(json.data.usage.totalTokens, 32 + 110 + 131 + 152 + 173);
  assert.equal(json.data.usage.cachedTokens, 50 + 60 + 70 + 80);
});

Deno.test("herramientas paralelas en un turno: todas se ejecutan y todas responden en el mismo turno siguiente", async () => {
  const h = buildAssistantHarness({
    script: [
      callTools([{ name: "search_contact", args: { query: "a" } }, { name: "count_contacts", args: {} }]),
      say("hecho"),
    ],
    skillData: { similarContacts: [buildContact()] },
  });
  const { json } = await chat(h);
  assert.equal(json.data.text, "hecho");
  assert.equal(h.provider.calls, 2);
  const results = h.provider.interactions[1].input as Record<string, unknown>[];
  assert.deepEqual(results.map((r) => r.name), ["search_contact", "count_contacts"]);
  // El historial persistido tiene UN turno de modelo con 2 llamadas y UN turno de usuario con 2 respuestas.
  const hist = persistedHistory(h, json.data.sessionId);
  const modelCalls = hist.filter((m) => m.role === "model" && (m.parts as { functionCall?: unknown }[]).some((p) => p.functionCall));
  assert.equal(modelCalls.length, 1);
  assert.equal(modelCalls[0].parts.length, 2);
});

Deno.test("tope de vueltas: modelo que nunca para → turno final SIN herramientas, respuesta honesta, sin 5xx", async () => {
  const h = buildAssistantHarness({
    script: [
      callTool("count_contacts", {}),
      // Cuando se agotan las vueltas, el turno de cierre (forceTextOnly) sí responde.
      (req) => (req.forceTextOnly ? say("Esto fue lo que hice: contar contactos.") : callTool("count_contacts", {})),
    ],
    repeatLast: true,
  });
  const { status, json } = await chat(h);
  assert.equal(status, 200);
  assert.equal(json.data.text, "Esto fue lo que hice: contar contactos.");
  // 6 vueltas del bucle + 1 de cierre; acotado, no infinito.
  assert.equal(h.provider.calls, 7);
  const last = h.provider.interactions.at(-1)!;
  assert.equal(last.forceTextOnly, true);
  // Las herramientas se siguen declarando en el cierre (no romper el cache del prefijo).
  assert.ok(last.toolNames.length > 0);
});

Deno.test("tope de vueltas + cierre vacío: mensaje honesto fijo, 200, y se persiste", async () => {
  const h = buildAssistantHarness({
    script: [(req) => (req.forceTextOnly ? { empty: true } : callTool("count_contacts", {}))],
    repeatLast: true,
  });
  const { status, json } = await chat(h);
  assert.equal(status, 200);
  assert.match(json.data.text, /revisa tu agenda/);
  const hist = persistedHistory(h, json.data.sessionId);
  const last = hist.at(-1)!;
  assert.equal(last.role, "model");
  assert.match((last.parts[0] as { text: string }).text, /revisa tu agenda/);
});

Deno.test("herramienta desconocida (no ofrecida): el modelo recibe un error y puede recuperarse", async () => {
  const h = buildAssistantHarness({ script: [callTool("drop_database", {}), say("No pude hacer eso.")] });
  const { status, json } = await chat(h);
  assert.equal(status, 200);
  assert.equal(json.data.text, "No pude hacer eso.");
  const res = h.provider.interactions[1].input as Record<string, unknown>[];
  assert.match(JSON.stringify(res[0].result), /Tool not available in this turn: drop_database/);
});

Deno.test("herramienta que truena: ok:false con el mensaje al modelo; el chat NO falla", async () => {
  const h = buildAssistantHarness({
    script: [callTool("search_contact", { query: "x" }), say("Tuve un problema al buscar.")],
    skillOverrides: { contactService: { findSimilarContact: () => Promise.reject(new Error("db down")) } },
  });
  const { status, json } = await chat(h);
  assert.equal(status, 200);
  assert.equal(json.data.text, "Tuve un problema al buscar.");
  const res = h.provider.interactions[1].input as Record<string, unknown>[];
  const payload = JSON.parse(((res[0].result as { text: string }[])[0]).text);
  assert.deepEqual(payload, { ok: false, error: "db down" });
});

Deno.test("args inválidos (Zod): la herramienta NO se ejecuta y el modelo recibe qué faltó", async () => {
  const h = buildAssistantHarness({ script: [callTool("search_contact", {}), say("¿A quién busco?")] });
  const { json } = await chat(h);
  assert.equal(json.data.text, "¿A quién busco?");
  assert.equal(h.skills.called("contactService.findSimilarContact").length, 0);
  const res = h.provider.interactions[1].input as Record<string, unknown>[];
  assert.match(JSON.stringify(res[0].result), /Missing required data/);
});

Deno.test("respuesta vacía del modelo: no truena; turno de cierre → texto", async () => {
  const h = buildAssistantHarness({
    script: [{ empty: true }, say("Perdón, ¿me repites?")],
  });
  const { status, json } = await chat(h);
  assert.equal(status, 200);
  assert.equal(json.data.text, "Perdón, ¿me repites?");
  assert.equal(h.provider.interactions[1].forceTextOnly, true);
});

Deno.test("respuesta vacía dos veces: mensaje honesto, sin 5xx", async () => {
  const h = buildAssistantHarness({ script: [{ empty: true }, { empty: true }] });
  const { status, json } = await chat(h);
  assert.equal(status, 200);
  assert.match(json.data.text, /revisa tu agenda/);
});

Deno.test("texto junto con function calls: se ejecutan las llamadas (el texto intermedio no es la respuesta)", async () => {
  const h = buildAssistantHarness({
    script: [{ text: "Voy a buscar…", calls: [{ name: "count_contacts", args: {} }] }, say("Tienes 0.")],
  });
  const { json } = await chat(h);
  assert.equal(json.data.text, "Tienes 0.");
});

Deno.test("AiProviderError (503) → 503 AI_PROVIDER_BUSY, cobro devuelto y sesión marcada provider_error no facturable", async () => {
  const h = buildAssistantHarness({ script: [{ error: new AiProviderError("busy") }] });
  const { status, json } = await chat(h);
  assert.equal(status, 503);
  assert.equal(json.success, false);
  assert.equal(json.errorCode, "AI_PROVIDER_BUSY");
  assert.deepEqual(h.usageRepo.refunds, ["charge-1"]);
  const [session] = [...h.sessionsRepo.sessions.values()];
  assert.equal(session.status, "provider_error");
  assert.equal(session.isBillable, false);
});

Deno.test("AiProviderError a media conversación (tras ejecutar herramientas): igual se devuelve el cobro", async () => {
  const h = buildAssistantHarness({
    script: [callTool("count_contacts", {}), { error: new AiProviderError("busy") }],
  });
  const { status, json } = await chat(h);
  assert.equal(status, 503);
  assert.equal(json.errorCode, "AI_PROVIDER_BUSY");
  assert.equal(h.usageRepo.refunds.length, 1);
});

Deno.test("fallo del clasificador (proveedor ocupado): se devuelve el cobro", async () => {
  const h = buildAssistantHarness({ classify: { error: new AiProviderError("busy") } });
  const { status, json } = await chat(h);
  assert.equal(status, 503);
  assert.equal(json.errorCode, "AI_PROVIDER_BUSY");
  assert.equal(h.usageRepo.refunds.length, 1, "el asesor no recibió respuesta: no se le cobra");
});

Deno.test("AiError del modelo (502 AI_ERROR): contrato de error; hoy NO se devuelve el cobro (decisión: solo AiProviderError reembolsa)", async () => {
  const h = buildAssistantHarness({ script: [{ error: new AiError("Error en processInteraction: x") }] });
  const { status, json } = await chat(h);
  assert.equal(status, 502);
  assert.equal(json.errorCode, "AI_ERROR");
  assert.equal(json.success, false);
  assert.equal(h.usageRepo.refunds.length, 0);
});

Deno.test("error crudo del proveedor (timeout/red): 500 INTERNAL_ERROR sin filtrar el mensaje interno", async () => {
  const h = buildAssistantHarness({ script: [{ error: new Error("fetch failed: ECONNRESET api-key=SECRET123") }] });
  const { status, json } = await chat(h);
  assert.equal(status, 500);
  assert.equal(json.errorCode, "INTERNAL_ERROR");
  assert.ok(!JSON.stringify(json).includes("SECRET123"));
  assert.ok(!JSON.stringify(json).includes("ECONNRESET"));
});

Deno.test("429 crudo del SDK de IA: 429 AI_PROVIDER_BUSY", async () => {
  const raw = Object.assign(new Error("rate"), { status: 429 });
  const h = buildAssistantHarness({ script: [{ error: raw }] });
  const { status, json } = await chat(h);
  assert.equal(status, 429);
  assert.equal(json.errorCode, "AI_PROVIDER_BUSY");
});

Deno.test("BUG: timeout/red del proveedor se cobra al asesor (no hay reembolso) aunque no recibió respuesta", async () => {
  const h = buildAssistantHarness({ script: [{ error: new Error("fetch failed") }] });
  const { status } = await chat(h);
  assert.equal(status, 500);
  assert.equal(h.usageRepo.refunds.length, 1, "esperado: reembolso cuando el asesor no recibe respuesta");
});

Deno.test("BUG: tras un error de proveedor NO ligado a AiProviderError la sesión queda 'active'/facturable", async () => {
  const h = buildAssistantHarness({ script: [{ error: new Error("fetch failed") }] });
  await chat(h);
  const [session] = [...h.sessionsRepo.sessions.values()];
  assert.equal(session.isBillable, false);
});
