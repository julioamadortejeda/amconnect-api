// Lo que el modelo RECIBE en cada turno: bloque [CONTEXT] (fecha, offset, idioma,
// pendientes, pantalla), herramientas ofrecidas por dominio, system prompt
// estático. Superficie: POST /ai/chat (headers x-timezone, Accept-Language).
import assert from "node:assert/strict";
import {
  buildAssistantHarness,
  callTool,
  postChat,
  quietLogs,
  say,
} from "../../../shared/testing/assistant_harness.ts";

type H = ReturnType<typeof buildAssistantHarness>;
const chat = (h: H, body: Record<string, unknown>, headers: Record<string, string> = {}) =>
  quietLogs(() => postChat(h, body, headers));
const firstUser = (h: H, i = 0) => h.provider.interactions[i].lastUserText;

// ─── Fecha, offset, idioma ──────────────────────────────────────────────────

Deno.test("[CONTEXT] va ANTES del mensaje y trae fecha local, offset e idioma", async () => {
  const h = buildAssistantHarness({ script: [say("ok")] });
  await chat(h, { message: "hola" }, { "x-timezone": "America/Mexico_City" });
  assert.match(
    firstUser(h),
    /^\[CONTEXT\] Current date\/time: (Monday|Tuesday|Wednesday|Thursday|Friday|Saturday|Sunday) \d{4}-\d{2}-\d{2}T[\d:]+-06:00 \| Timezone offset: -06:00 \| Reply language: Spanish\nNext 7 days: (\w{3} \d{4}-\d{2}-\d{2}(, )?){7}\n\nhola$/,
  );
});

Deno.test("x-timezone → el offset del [CONTEXT] sigue al header (Tokio +09:00)", async () => {
  const h = buildAssistantHarness({ script: [say("ok")] });
  await chat(h, { message: "hola" }, { "x-timezone": "Asia/Tokyo" });
  assert.match(firstUser(h), /Timezone offset: \+09:00/);
});

Deno.test("sin x-timezone: default America/Mexico_City (-06:00); basura → mismo default", async () => {
  const a = buildAssistantHarness({ script: [say("ok")] });
  await chat(a, { message: "hola" });
  assert.match(firstUser(a), /Timezone offset: -06:00/);
  const b = buildAssistantHarness({ script: [say("ok")] });
  await chat(b, { message: "hola" }, { "x-timezone": "Mars/Olympus_Mons" });
  assert.match(firstUser(b), /Timezone offset: -06:00/);
});

Deno.test("x-timezone-offset sirve cuando x-timezone no es IANA", async () => {
  const h = buildAssistantHarness({ script: [say("ok")] });
  await chat(h, { message: "hola" }, { "x-timezone": "GMT-06:00 raro", "x-timezone-offset": "+05:30" });
  assert.match(firstUser(h), /Timezone offset: \+05:30/);
});

Deno.test("idioma de respuesta: 1) lo detectado por el clasificador gana", async () => {
  const h = buildAssistantHarness({ script: [say("ok")], classify: { domains: ["contact"], language: "English" } });
  await chat(h, { message: "hola" }, { "Accept-Language": "es-MX" });
  assert.match(firstUser(h), /Reply language: English/);
});

Deno.test("idioma de respuesta: 3) sin idioma detectado ni historial, manda el Accept-Language de la app", async () => {
  const en = buildAssistantHarness({ script: [say("ok")], classify: { domains: ["contact"] } });
  await chat(en, { message: "ok" }, { "Accept-Language": "en-US,en;q=0.9" });
  assert.match(firstUser(en), /Reply language: English/);
  const es = buildAssistantHarness({ script: [say("ok")], classify: { domains: ["contact"] } });
  await chat(es, { message: "ok" }, { "Accept-Language": "fr-FR" });
  assert.match(firstUser(es), /Reply language: Spanish/, "idioma desconocido cae a español");
  const none = buildAssistantHarness({ script: [say("ok")], classify: { domains: ["contact"] } });
  await chat(none, { message: "ok" });
  assert.match(firstUser(none), /Reply language: Spanish/);
});

Deno.test("idioma de respuesta: 2) un turno sin idioma propio ('el segundo') hereda el de la conversación, no el de la app", async () => {
  const h = buildAssistantHarness({
    script: [say("one"), say("two")],
    classify: (m) => (m === "hello there" ? { domains: ["contact"], language: "English" } : { domains: ["contact"] }),
  });
  const a = await chat(h, { message: "hello there" }, { "Accept-Language": "es" });
  await chat(h, { message: "the second", sessionId: a.json.data.sessionId }, { "Accept-Language": "es" });
  // classify devuelve language solo para "hello there"
  assert.match(firstUser(h, 1), /Reply language: English/);
});

Deno.test("el clasificador recibe el mensaje crudo (sin [CONTEXT]) y el catálogo de dominios", async () => {
  const h = buildAssistantHarness({ script: [say("ok")] });
  await chat(h, { message: "busca a Julio" });
  assert.equal(h.provider.classified[0].message, "busca a Julio");
  assert.deepEqual(h.provider.classified[0].availableDomains, ["contact", "policy", "reminder", "commitment", "pending_task", "catalog", "knowledge"]);
});

// ─── System prompt estático ─────────────────────────────────────────────────

Deno.test("system prompt: se pide ai_chat_system SIN variables y es idéntico entre asesores/husos/idiomas (cache implícito)", async () => {
  const a = buildAssistantHarness({ script: [say("ok")] });
  await chat(a, { message: "hola" }, { "x-timezone": "Asia/Tokyo", "Accept-Language": "en" });
  const b = buildAssistantHarness({ script: [say("ok")], agentId: "c3c3c3c3-0000-4000-8000-00000000000c" });
  await chat(b, { message: "otra cosa" }, { "x-timezone": "America/Bogota", "Accept-Language": "es" });
  assert.deepEqual(a.prompts.requested, [{ code: "ai_chat_system", vars: {} }]);
  assert.equal(a.provider.interactions[0].systemInstruction, b.provider.interactions[0].systemInstruction);
});

Deno.test("system prompt y herramientas son idénticos en TODAS las vueltas del bucle (prefijo estable)", async () => {
  const h = buildAssistantHarness({
    script: [callTool("count_contacts", {}), callTool("count_contacts", {}), say("ok")],
  });
  await chat(h, { message: "hola" });
  const [i0, i1, i2] = h.provider.interactions;
  assert.equal(i0.systemInstruction, i1.systemInstruction);
  assert.equal(i1.systemInstruction, i2.systemInstruction);
  assert.deepEqual(i0.toolNames, i1.toolNames);
  assert.deepEqual(i1.toolNames, i2.toolNames);
  assert.equal(i0.forceTextOnly, false);
});

// ─── Selección de herramientas por dominio ──────────────────────────────────

Deno.test("dominios: clasificador 'contact' → herramientas de contacto + siempre activos (pending_task, knowledge/recall); sin póliza", async () => {
  const h = buildAssistantHarness({ script: [say("ok")], classify: { domains: ["contact"], language: "Spanish" } });
  await chat(h, { message: "hola" });
  const t = h.provider.toolsAt(0);
  for (const n of ["search_contact", "save_pending_task", "search_knowledge", "recall"]) assert.ok(t.includes(n), n);
  for (const n of ["create_policy", "create_reminder", "create_commitment", "resolve_pending_task"]) assert.ok(!t.includes(n), `no debe ofrecer ${n}`);
});

Deno.test("dominios: recordatorio y compromiso siempre van juntos", async () => {
  const h = buildAssistantHarness({ script: [say("ok")], classify: { domains: ["reminder"], language: "Spanish" } });
  await chat(h, { message: "qué tengo en septiembre" });
  const t = h.provider.toolsAt(0);
  assert.ok(t.includes("get_upcoming_reminders") && t.includes("get_commitments"));
  const h2 = buildAssistantHarness({ script: [say("ok")], classify: { domains: ["commitment"], language: "Spanish" } });
  await chat(h2, { message: "x" });
  assert.ok(h2.provider.toolsAt(0).includes("get_upcoming_reminders"));
});

Deno.test("dominios: póliza arrastra catálogo (aseguradora/ramo/producto)", async () => {
  const h = buildAssistantHarness({ script: [say("ok")], classify: { domains: ["policy"], language: "Spanish" } });
  await chat(h, { message: "x" });
  const t = h.provider.toolsAt(0);
  assert.ok(t.includes("create_policy"));
  assert.ok(t.some((n) => n.startsWith("search_carrier") || n.startsWith("search_branch") || n.startsWith("search_product")));
});

Deno.test("dominios: clasificador vacío → se ofrecen TODOS", async () => {
  const h = buildAssistantHarness({ script: [say("ok")], classify: { domains: [], language: "Spanish" } });
  await chat(h, { message: "x" });
  const t = h.provider.toolsAt(0);
  for (const n of ["search_contact", "create_policy", "create_reminder", "create_commitment"]) assert.ok(t.includes(n), n);
});

Deno.test("dominios: la pantalla activa fuerza su dominio aunque el clasificador no lo diga", async () => {
  const h = buildAssistantHarness({ script: [say("ok")], classify: { domains: ["reminder"], language: "Spanish" } });
  await chat(h, { message: "x", context: { type: "policy", id: "3f1c2a8e-5b7d-4e19-9a0c-2d6f8b1e4c37", data: { policyNumber: "GM-1" } } });
  assert.ok(h.provider.toolsAt(0).includes("get_policy"));
});

Deno.test("contexto de pantalla: se inyecta en el [CONTEXT] con tipo, id y datos", async () => {
  const h = buildAssistantHarness({ script: [say("ok")] });
  const id = "3f1c2a8e-5b7d-4e19-9a0c-2d6f8b1e4c37";
  await chat(h, { message: "x", context: { type: "contact", id, data: { fullName: "Julio" } } });
  assert.match(firstUser(h), new RegExp(`Active screen context \\(contact ID: ${id}\\):\\n\\{\\s+"fullName": "Julio"`));
});

Deno.test("recall: alcanzable desde el chat con CUALQUIER clasificación (ALWAYS_ACTIVE knowledge) y su resultado vuelve al modelo", async () => {
  const seen: unknown[] = [];
  const h = buildAssistantHarness({
    script: [callTool("recall", { query: "hernia" }), say("Encontré una nota.")],
    classify: { domains: ["reminder"], language: "Spanish" },
    skillOverrides: {
      recallService: {
        recall: (_agent: string, p: unknown) => {
          seen.push(p);
          return Promise.resolve({ searchId: "s1", page: 1, groups: { notes: { items: [], moreAvailable: false } } });
        },
      },
    },
  });
  const { json } = await chat(h, { message: "qué tengo de hernia" });
  assert.ok(h.provider.toolsAt(0).includes("recall"));
  assert.equal(json.data.text, "Encontré una nota.");
  assert.deepEqual(seen, [{ query: "hernia", contactId: undefined, page: undefined, groups: undefined, searchId: undefined, noteId: undefined }]);
  const res = h.provider.interactions[1].input as Record<string, unknown>[];
  const payload = JSON.parse((res[0].result as { text: string }[])[0].text);
  assert.equal(payload.searchId, "s1");
});

// ─── Sesión de ingesta de póliza ────────────────────────────────────────────

Deno.test("sesión policy_ingestion: NO clasifica, usa prompt policy_ingestion_system y solo herramientas de ingesta", async () => {
  const sid = "22222222-2222-4222-8222-222222222222";
  const h = buildAssistantHarness({ script: [say("Resumen de la póliza…")] });
  h.sessionsRepo.seedSession({ id: sid, agentId: h.agentId, type: "policy_ingestion" });
  const { status, json } = await chat(h, { message: "confirmo", sessionId: sid });
  assert.equal(status, 200);
  assert.equal(json.data.text, "Resumen de la póliza…");
  assert.equal(h.provider.classified.length, 0);
  assert.equal(h.prompts.requested[0].code, "policy_ingestion_system");
  const t = h.provider.toolsAt(0);
  assert.ok(t.includes("confirm_policy_ingestion") && t.includes("update_policy_ingestion"));
  assert.ok(!t.includes("search_contact"));
});

// ─── Tareas pendientes ──────────────────────────────────────────────────────

Deno.test("pendientes: sin tareas, resolve_pending_task NO se ofrece (para que no haya salida falsa)", async () => {
  const h = buildAssistantHarness({ script: [say("ok")] });
  await chat(h, { message: "hola" });
  assert.ok(!h.provider.toolsAt(0).includes("resolve_pending_task"));
  assert.ok(!firstUser(h).includes("Active pending tasks"));
});

Deno.test("pendientes: guardar → siguiente turno la inyecta en [CONTEXT] y ofrece resolve; resolver → desaparece", async () => {
  const h = buildAssistantHarness({
    script: [
      callTool("save_pending_task", { task_type: "create_reminder", payload: { who: "Julio" }, missing: ["fecha"] }),
      say("¿Para qué fecha?"),
      say("Ok, ¿algo más?"),
    ],
  });
  const a = await chat(h, { message: "recuérdame llamar a Julio" });
  const sid = a.json.data.sessionId;
  assert.equal(h.sessionsRepo.pending.size, 1);
  assert.ok(!h.provider.toolsAt(0).includes("resolve_pending_task"), "en el turno que la crea aún no hay nada que resolver");

  const b = await chat(h, { message: "el viernes", sessionId: sid });
  assert.equal(b.status, 200);
  const turn2 = firstUser(h, 2);
  assert.match(turn2, /Active pending tasks requiring resolution:\n- ID: pt-1, tipo: create_reminder, datos: \{"who":"Julio","missing":\["fecha"\]\}/);
  assert.ok(h.provider.toolsAt(2).includes("resolve_pending_task"));

  // El modelo la resuelve en el turno 3.
  h.provider.push(callTool("resolve_pending_task", { pending_task_id: "pt-1" }), say("Listo."));
  await chat(h, { message: "gracias", sessionId: sid });
  assert.equal(h.sessionsRepo.pending.get("pt-1")!.status, "resolved");
  h.provider.push(say("de nada"));
  await chat(h, { message: "otra", sessionId: sid });
  const last = h.provider.interactions.at(-1)!;
  assert.ok(!last.lastUserText.includes("Active pending tasks"));
  assert.ok(!last.toolNames.includes("resolve_pending_task"));
});

Deno.test("pendientes: una tarea de OTRA sesión no se inyecta", async () => {
  const h = buildAssistantHarness({ script: [say("ok")] });
  await h.sessionService.savePendingTask("otra-sesion", h.agentId, "x", { a: 1 });
  await chat(h, { message: "hola" });
  assert.ok(!firstUser(h).includes("Active pending tasks"));
});
