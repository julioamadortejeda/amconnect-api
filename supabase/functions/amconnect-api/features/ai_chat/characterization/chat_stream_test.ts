// POST /ai/chat/stream (SSE, Fase 2 paso 4): orden de eventos, etiquetas sin
// nombres técnicos, errores antes/después de abrir el stream con sus reglas de
// cobro, y cancelación a medio turno (desconexión del cliente y /cancel).
import assert from "node:assert/strict";
import {
  type AssistantHarness,
  buildAssistantHarness,
  callTool,
  parseSse,
  persistedHistory,
  postChat,
  postChatStream,
  quietLogs,
  request,
  say,
  type SseEvent,
  usage,
} from "../../../shared/testing/assistant_harness.ts";
import { AiError, AiProviderError } from "../../../shared/errors.ts";
import { activeTurns } from "../active_turns.ts";

const SESSION = "22222222-2222-4222-8222-222222222222";
const OTHER_AGENT = "b2b2b2b2-0000-4000-8000-00000000000b";

const stream = (h: AssistantHarness, body: unknown, signal?: AbortSignal) =>
  quietLogs(() => postChatStream(h, body, {}, signal));
const names = (events: SseEvent[]) => events.map((e) => e.event);

/** Espera (sin timers largos) a que una condición se cumpla. */
async function until(cond: () => boolean, tries = 200): Promise<void> {
  for (let i = 0; i < tries && !cond(); i++) await new Promise((r) => setTimeout(r, 1));
  assert.ok(cond(), "la condición nunca se cumplió");
}

Deno.test("stream: headers SSE (event-stream, no-cache, sin buffering)", async () => {
  const h = buildAssistantHarness({ script: [say("hola")] });
  const r = await stream(h, { message: "hola" });
  assert.equal(r.status, 200);
  assert.match(r.headers.get("content-type")!, /^text\/event-stream/);
  assert.equal(r.headers.get("cache-control"), "no-cache");
  assert.equal(r.headers.get("x-accel-buffering"), "no");
});

Deno.test("stream texto simple: status → delta → done, ids secuenciales; done = data del JSON", async () => {
  const h = buildAssistantHarness({ script: [say("hola Rosa", usage(10, 2))] });
  const r = await stream(h, { message: "hola" });
  assert.deepEqual(names(r.events), ["status", "delta", "done"]);
  assert.deepEqual(r.events.map((e) => e.id), ["1", "2", "3"]);
  const [status, delta, done] = r.events;
  assert.equal(status.data.phase, "thinking");
  assert.equal(status.data.sessionId, done.data.sessionId, "el status ya trae el id de la sesión (nueva)");
  assert.deepEqual(delta.data, { text: "hola Rosa" });
  assert.equal(done.data.text, "hola Rosa");
  assert.equal(done.data.aiBackend, "studio");
  assert.equal(done.data.usage.promptTokens, 10);
  assert.ok(done.data.sessionUsage);
  assert.deepEqual(h.usageRepo.increments, [{ agentId: h.agentId, field: "chat" }]);
  assert.equal(h.usageRepo.refunds.length, 0);
});

Deno.test("stream = JSON: mismo guion, mismo data final e historial persistido", async () => {
  const script = () => [callTool("count_contacts", {}, usage(5, 1)), say("tienes 0", usage(7, 2))];
  const a = buildAssistantHarness({ script: script() });
  const b = buildAssistantHarness({ script: script() });
  const json = await quietLogs(() => postChat(a, { message: "cuántos" }));
  const sse = await stream(b, { message: "cuántos" });
  const done = sse.events.at(-1)!.data;
  const strip = (d: Record<string, unknown>) => ({ ...d, sessionId: "x" });
  assert.deepEqual(strip(done), strip(json.json.data));
  assert.deepEqual(
    persistedHistory(b, done.sessionId).map((m) => m.role),
    persistedHistory(a, json.json.data.sessionId).map((m) => m.role),
  );
});

Deno.test("stream con herramientas: tool started/finished con `name` (código) y etiqueta humana de respaldo", async () => {
  const h = buildAssistantHarness({
    script: [callTool("search_contact", { query: "Rosa" }), callTool("count_contacts", {}), say("listo")],
  });
  const r = await stream(h, { message: "busca a Rosa" });
  assert.deepEqual(names(r.events), ["status", "tool", "tool", "status", "tool", "tool", "status", "delta", "done"]);
  const tools = r.events.filter((e) => e.event === "tool");
  assert.deepEqual(tools[0].data, { name: "search_contact", label: "Buscando contacto", state: "started" });
  assert.equal(tools[1].data.state, "finished");
  assert.equal(typeof tools[1].data.ok, "boolean");
  assert.deepEqual(tools[2].data, { name: "count_contacts", label: "Trabajando…", state: "started" }, "sin etiqueta propia → genérica");
  for (const t of tools) assert.deepEqual(Object.keys(t.data).filter((k) => !["name", "label", "state", "ok"].includes(k)), []);
  assert.equal(tools[1].data.name, "search_contact");
});

Deno.test("stream: etiquetas en inglés cuando el turno es en inglés", async () => {
  const h = buildAssistantHarness({
    script: [callTool("search_contact", { query: "Rosa" }), say("done")],
    classify: { domains: ["contact"], language: "English" },
  });
  const r = await stream(h, { message: "find Rosa" });
  assert.equal(r.events.find((e) => e.event === "tool")!.data.label, "Looking up contact");
});

// ─── Errores antes de abrir el stream: status HTTP + sobre JSON ─────────────

Deno.test("stream: body inválido → 422 JSON, sin cobro", async () => {
  const h = buildAssistantHarness({ script: [say("x")] });
  const r = await stream(h, { message: "" });
  assert.equal(r.status, 422);
  assert.equal(r.json.errorCode, "VALIDATION_FAILED");
  assert.equal(h.usageRepo.increments.length, 0);
});

Deno.test("stream: cuota agotada → 429 QUOTA_EXCEEDED JSON, sin modelo ni sesión", async () => {
  const h = buildAssistantHarness({ script: [say("x")], quotaExceeded: true });
  const r = await stream(h, { message: "hola" });
  assert.equal(r.status, 429);
  assert.equal(r.json.errorCode, "QUOTA_EXCEEDED");
  assert.equal(h.provider.calls, 0);
  assert.equal(h.sessionsRepo.sessions.size, 0);
});

Deno.test("stream: sesión ajena → 404 JSON antes del stream, cobro devuelto", async () => {
  const h = buildAssistantHarness({ script: [say("x")] });
  h.sessionsRepo.seedSession({ id: SESSION, agentId: OTHER_AGENT });
  const r = await stream(h, { message: "hola", sessionId: SESSION });
  assert.equal(r.status, 404);
  assert.equal(r.json.errorCode, "RESOURCE_NOT_FOUND");
  assert.equal(h.provider.calls, 0);
  assert.equal(h.usageRepo.refunds.length, 1);
});

Deno.test("stream: turno en curso en la sesión → 409 JSON antes del stream, cobro devuelto, candado intacto", async () => {
  const h = buildAssistantHarness({ script: [say("x")] });
  const lockedUntil = new Date(Date.now() + 60_000);
  h.sessionsRepo.seedSession({ id: SESSION, agentId: h.agentId, turnLockedUntil: lockedUntil });
  const r = await stream(h, { message: "hola", sessionId: SESSION });
  assert.equal(r.status, 409);
  assert.equal(r.json.errorCode, "RESOURCE_CONFLICT");
  assert.equal(h.provider.calls, 0);
  assert.equal(h.usageRepo.refunds.length, 1);
  assert.equal(h.sessionsRepo.sessions.get(SESSION)!.turnLockedUntil, lockedUntil, "no suelta el candado ajeno");
});

// ─── Errores con el stream abierto: evento `error` ──────────────────────────

Deno.test("stream: AiProviderError en la primera llamada → evento error AI_PROVIDER_BUSY, cobro devuelto, sesión no facturable", async () => {
  const h = buildAssistantHarness({ script: [{ error: new AiProviderError("ocupado") }] });
  const r = await stream(h, { message: "hola" });
  assert.equal(r.status, 200);
  assert.deepEqual(names(r.events), ["status", "error"]);
  assert.equal(r.events[1].data.errorCode, "AI_PROVIDER_BUSY");
  assert.equal(typeof r.events[1].data.error, "string");
  assert.equal(h.usageRepo.refunds.length, 1);
  const s = [...h.sessionsRepo.sessions.values()][0];
  assert.equal(s.status, "provider_error");
  assert.equal(s.isBillable, false);
});

Deno.test("stream: falla del clasificador (antes de la primera llamada al modelo) → error, cobro devuelto", async () => {
  const h = buildAssistantHarness({ script: [say("x")], classify: { error: new AiProviderError("ocupado") } });
  const r = await stream(h, { message: "hola" });
  assert.deepEqual(names(r.events), ["error"]);
  assert.equal(r.events[0].data.errorCode, "AI_PROVIDER_BUSY");
  assert.equal(h.provider.calls, 0);
  assert.equal(h.usageRepo.refunds.length, 1);
});

Deno.test("stream: AiError tras una herramienta → evento error AI_ERROR, SIN devolución (decisión del usuario)", async () => {
  const h = buildAssistantHarness({ script: [callTool("count_contacts", {}), { error: new AiError("respuesta inutilizable") }] });
  const r = await stream(h, { message: "hola" });
  assert.deepEqual(names(r.events), ["status", "tool", "tool", "status", "error"]);
  assert.equal(r.events.at(-1)!.data.errorCode, "AI_ERROR");
  assert.equal(h.usageRepo.refunds.length, 0);
});

Deno.test("stream: error crudo → INTERNAL_ERROR sin filtrar el mensaje, cobro devuelto; el candado se suelta", async () => {
  const h = buildAssistantHarness({ script: [{ error: new Error("ECONNRESET secreto interno") }] });
  h.sessionsRepo.seedSession({ id: SESSION, agentId: h.agentId });
  const r = await stream(h, { message: "hola", sessionId: SESSION });
  const err = r.events.at(-1)!;
  assert.equal(err.event, "error");
  assert.equal(err.data.errorCode, "INTERNAL_ERROR");
  assert.ok(!r.raw.includes("ECONNRESET"));
  assert.equal(h.usageRepo.refunds.length, 1);
  assert.equal(h.sessionsRepo.sessions.get(SESSION)!.turnLockedUntil, null);
});

// ─── Cancelación (§7.3) ─────────────────────────────────────────────────────

Deno.test("cancelar por desconexión a medio turno: sin más llamadas al modelo, historial parcial, candado libre, sin devolución", async () => {
  const disconnect = new AbortController();
  const h = buildAssistantHarness({
    script: [callTool("count_contacts", {}, usage(40, 4)), say("nunca")],
    skillOverrides: {
      contactService: { count: () => (disconnect.abort(), Promise.resolve(3)) },
    },
  });
  h.sessionsRepo.seedSession({ id: SESSION, agentId: h.agentId, lastInteractionId: "int-previo" });
  const r = await stream(h, { message: "cuántos", sessionId: SESSION }, disconnect.signal);

  assert.equal(h.provider.calls, 1, "no hay segunda llamada al modelo");
  assert.deepEqual(names(r.events), ["status", "tool", "tool", "cancelled"]);
  assert.deepEqual(r.events.at(-1)!.data, { sessionId: SESSION, modelCalls: 1 });

  const s = h.sessionsRepo.sessions.get(SESSION)!;
  assert.deepEqual(persistedHistory(h, SESSION).map((m) => m.role), ["user", "model", "user"]);
  assert.ok((persistedHistory(h, SESSION)[2].parts[0] as { functionResponse?: unknown }).functionResponse);
  assert.equal(s.lastInteractionId, "int-previo", "la cadena del Interactions API no avanza a function calls sin respuesta");
  assert.equal(s.status, "cancelled");
  assert.equal(s.turnLockedUntil, null);
  assert.equal(h.usageRepo.refunds.length, 0, "Gemini ya procesó una llamada: se cobra");
  assert.ok(h.sessionsRepo.tokenRows.some((r) => r.promptTokens === 40), "los tokens gastados se registran");
  assert.equal(activeTurns.has(SESSION), false);
});

Deno.test("cancelar antes de la primera llamada al modelo: cobro devuelto e historial sin tocar", async () => {
  const disconnect = new AbortController();
  const h = buildAssistantHarness({
    script: [say("nunca")],
    classify: () => (disconnect.abort(), { domains: ["contact"], language: "Spanish", usage: usage(9, 1) }),
  });
  const seeded = [{ role: "user", parts: [{ text: "antes" }] }, { role: "model", parts: [{ text: "ok" }] }];
  h.sessionsRepo.seedSession({ id: SESSION, agentId: h.agentId, history: seeded });
  const r = await stream(h, { message: "hola", sessionId: SESSION }, disconnect.signal);

  assert.equal(h.provider.calls, 0);
  assert.deepEqual(names(r.events), ["cancelled"]);
  assert.equal(r.events[0].data.modelCalls, 0);
  assert.equal(h.usageRepo.refunds.length, 1);
  assert.deepEqual(persistedHistory(h, SESSION), seeded);
  assert.equal(h.sessionsRepo.sessions.get(SESSION)!.turnLockedUntil, null);
  assert.ok(h.sessionsRepo.tokenRows.some((r) => r.promptTokens === 9), "el clasificador sí se registra");
});

Deno.test("cancelar con el stream cerrado por el cliente (reader.cancel): el turno se detiene y suelta el candado", async () => {
  let openGate!: () => void;
  const gate = new Promise<void>((r) => (openGate = r));
  const h = buildAssistantHarness({
    script: [callTool("count_contacts", {}), say("nunca")],
    skillOverrides: { contactService: { count: () => gate.then(() => 3) } },
  });
  h.sessionsRepo.seedSession({ id: SESSION, agentId: h.agentId });
  await quietLogs(async () => {
    const res = await h.app.request("/amconnect-api/ai/chat/stream", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ message: "cuántos", sessionId: SESSION }),
    });
    const reader = res.body!.getReader();
    let seen = "";
    while (!parseSse(seen).some((e) => e.event === "tool")) {
      seen += new TextDecoder().decode((await reader.read()).value);
    }
    await reader.cancel();
    openGate();
    await until(() => h.sessionsRepo.sessions.get(SESSION)!.status === "cancelled");
    await until(() => h.sessionsRepo.sessions.get(SESSION)!.turnLockedUntil === null);
  });
  assert.equal(h.provider.calls, 1);
  assert.equal(h.usageRepo.refunds.length, 0);
});

Deno.test("POST /ai/sessions/:id/cancel detiene un turno en curso de la sesión (misma instancia)", async () => {
  let cancelResponse: unknown;
  const h: AssistantHarness = buildAssistantHarness({
    script: [callTool("count_contacts", {}), say("nunca")],
    skillOverrides: {
      contactService: {
        count: async () => {
          cancelResponse = (await request(h, "POST", `/ai/sessions/${SESSION}/cancel`)).json;
          return 3;
        },
      },
    },
  });
  h.sessionsRepo.seedSession({ id: SESSION, agentId: h.agentId });
  const r = await stream(h, { message: "cuántos", sessionId: SESSION });

  assert.deepEqual(cancelResponse, { success: true, data: { cancelled: true, cancelledTasks: 0, cancelledTurn: true } });
  assert.equal(h.provider.calls, 1);
  assert.equal(r.events.at(-1)!.event, "cancelled");
  assert.equal(h.sessionsRepo.sessions.get(SESSION)!.turnLockedUntil, null);
});

Deno.test("cancel de una sesión AJENA: 404 y NO aborta el turno registrado con ese id", async () => {
  const h = buildAssistantHarness({ script: [] });
  h.sessionsRepo.seedSession({ id: SESSION, agentId: OTHER_AGENT });
  const turn = activeTurns.register(SESSION);
  try {
    const r = await quietLogs(() => request(h, "POST", `/ai/sessions/${SESSION}/cancel`));
    assert.equal(r.status, 404);
    assert.equal(turn.signal.aborted, false);
  } finally {
    turn.release();
  }
});

Deno.test("el endpoint JSON no se registra como turno cancelable", async () => {
  let registered: boolean | undefined;
  const h: AssistantHarness = buildAssistantHarness({
    script: [callTool("count_contacts", {}), say("ok")],
    skillOverrides: {
      contactService: {
        count: () => {
          registered = activeTurns.has(SESSION);
          return Promise.resolve(1);
        },
      },
    },
  });
  h.sessionsRepo.seedSession({ id: SESSION, agentId: h.agentId });
  const r = await quietLogs(() => postChat(h, { message: "cuántos", sessionId: SESSION }));
  assert.equal(r.status, 200);
  assert.equal(registered, false);
});
