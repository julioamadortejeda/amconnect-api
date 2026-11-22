// Selección de herramientas en modo "all" (TOOL_SELECTION_MODE) y su par
// "by_domain". Superficie: POST /ai/chat. El arnés usa "by_domain" por defecto
// (las demás pruebas de caracterización fijan ese comportamiento); aquí se
// pide el modo explícito.
import assert from "node:assert/strict";
import { buildAssistantHarness, callTool, postChat, quietLogs, say } from "../../../shared/testing/assistant_harness.ts";
import { skillRegistry } from "../skills/index.ts";

type H = ReturnType<typeof buildAssistantHarness>;
const chat = (h: H, body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  quietLogs(() => postChat(h, body, headers));
const firstUser = (h: H, i = 0) => h.provider.interactions[i].lastUserText;

const CHAT_TOOLS = skillRegistry.filter((s) => s.domain !== "policy_ingestion").map((s) => s.declaration.name);

Deno.test("all: no llama al clasificador y ofrece TODAS las herramientas de chat (sin resolve_pending_task sin pendientes)", async () => {
  const h = buildAssistantHarness({ script: [say("ok")], toolSelectionMode: "all" });
  const r = await chat(h, { message: "dame el teléfono de Rosa" });
  assert.equal(r.status, 200);
  assert.equal(h.provider.classified.length, 0);
  assert.deepEqual(h.provider.toolsAt(0), CHAT_TOOLS.filter((n) => n !== "resolve_pending_task"));
  assert.ok(!h.provider.toolsAt(0).includes("confirm_policy_ingestion"));
});

Deno.test("all: el orden es idéntico entre turnos y entre asesores (prefijo estable)", async () => {
  const a = buildAssistantHarness({ script: [say("1"), say("2")], toolSelectionMode: "all" });
  const r1 = await chat(a, { message: "hola, ¿qué tengo hoy?" });
  await chat(a, { message: "show me my clients", sessionId: r1.json.data.sessionId });
  const b = buildAssistantHarness({ script: [say("x")], toolSelectionMode: "all", agentId: "c3c3c3c3-0000-4000-8000-00000000000c" });
  await chat(b, { message: "crea un recordatorio" });
  assert.deepEqual(a.provider.toolsAt(0), a.provider.toolsAt(1));
  assert.deepEqual(a.provider.toolsAt(0), b.provider.toolsAt(0));
});

Deno.test("all: con una tarea pendiente SÍ se ofrece resolve_pending_task", async () => {
  const h = buildAssistantHarness({
    toolSelectionMode: "all",
    script: [
      callTool("save_pending_task", { task_type: "create_reminder", payload: { who: "Julio" }, missing: ["fecha"] }),
      say("¿Fecha?"),
      say("ok"),
    ],
  });
  const a = await chat(h, { message: "recuérdame llamar a Julio" });
  assert.ok(!h.provider.toolsAt(0).includes("resolve_pending_task"));
  await chat(h, { message: "el viernes", sessionId: a.json.data.sessionId });
  assert.ok(h.provider.toolsAt(2).includes("resolve_pending_task"));
});

Deno.test("all: bug-7, una herramienta no ofrecida (resolve_pending_task sin pendientes) sigue rechazándose", async () => {
  const h = buildAssistantHarness({
    toolSelectionMode: "all",
    script: [callTool("resolve_pending_task", { pending_task_id: "inventado" }), say("listo")],
  });
  await chat(h, { message: "el segundo" });
  assert.match(JSON.stringify(h.provider.interactions[1].input), /Tool not available in this turn: resolve_pending_task/);
  assert.equal(h.sessionsRepo.pending.size, 0);
});

Deno.test("all: el idioma se detecta localmente del mensaje (gana al Accept-Language)", async () => {
  const h = buildAssistantHarness({ script: [say("ok")], toolSelectionMode: "all" });
  await chat(h, { message: "show me the policies of my client" }, { "Accept-Language": "es-MX" });
  assert.match(firstUser(h), /Reply language: English/);
});

Deno.test("all: mensaje ambiguo ('ok') usa el idioma de la app; con conversación, hereda el de ella", async () => {
  const h = buildAssistantHarness({ script: [say("1")], toolSelectionMode: "all" });
  await chat(h, { message: "ok" }, { "Accept-Language": "en-US" });
  assert.match(firstUser(h, 0), /Reply language: English/);

  const h2 = buildAssistantHarness({ script: [say("1"), say("2")], toolSelectionMode: "all" });
  const b = await chat(h2, { message: "dame todos los clientes por favor" }, { "Accept-Language": "en" });
  assert.match(firstUser(h2, 0), /Reply language: Spanish/);
  await chat(h2, { message: "ok", sessionId: b.json.data.sessionId }, { "Accept-Language": "en" });
  assert.match(firstUser(h2, 1), /Reply language: Spanish/);
});

Deno.test("all: se registra la línea [TOOLS] sin contenido del mensaje", async () => {
  const h = buildAssistantHarness({ script: [say("ok")], toolSelectionMode: "all" });
  const lines: string[] = [];
  const orig = console.warn;
  console.warn = (...a: unknown[]) => {
    lines.push(a.join(" "));
  };
  try {
    await postChat(h, { message: "secreto123 dame el teléfono de Rosa" }, {});
  } finally {
    console.warn = orig;
  }
  const line = lines.find((l) => l.startsWith("[TOOLS]"));
  assert.ok(line);
  assert.match(line!, /^\[TOOLS\] mode=all count=\d+ lang=Spanish langSource=detected$/);
  assert.ok(!line!.includes("secreto"));
});

Deno.test("all: la sesión de ingesta de póliza no cambia (sus herramientas, sin clasificar)", async () => {
  const sid = "22222222-2222-4222-8222-222222222222";
  const h = buildAssistantHarness({ script: [say("ok")], toolSelectionMode: "all" });
  h.sessionsRepo.seedSession({ id: sid, agentId: h.agentId, type: "policy_ingestion" });
  await chat(h, { message: "confirmo", sessionId: sid });
  const t = h.provider.toolsAt(0);
  assert.equal(h.provider.classified.length, 0);
  assert.ok(t.includes("confirm_policy_ingestion") && !t.includes("search_contact"));
});

Deno.test("by_domain: sigue clasificando y ofreciendo solo los dominios elegidos", async () => {
  const h = buildAssistantHarness({
    script: [say("ok")],
    toolSelectionMode: "by_domain",
    classify: { domains: ["contact"], language: "Spanish" },
  });
  await chat(h, { message: "hola" });
  assert.equal(h.provider.classified.length, 1);
  assert.ok(!h.provider.toolsAt(0).includes("create_policy"));
});
