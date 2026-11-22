// AgentLoop: secuencia de eventos, lista blanca (bug #7), agotamiento con
// pasada de cierre, cancelación antes de la siguiente llamada y suma de uso.
import "../../shared/testing/test_env.ts";
import assert from "node:assert/strict";
import { AiRole, type AiMessage } from "../../core/ai_provider.interface.ts";
import {
  callTool,
  callTools,
  quietLogs,
  say,
  ScriptedAiProvider,
  type StepSource,
  usage,
} from "../../shared/testing/assistant_harness.ts";
import type { SkillContext } from "./skills/skill.core.ts";
import { AgentLoop, type AgentLoopInput, EXHAUSTED_FALLBACK_TEXT, type SkillRunner } from "./agent_loop.ts";
import { type AgentEvent, toolLabel } from "./agent_events.ts";

const CTX = { agentId: "agent-1", sessionId: "s-1" } as unknown as SkillContext;

/** Skill falsa: devuelve lo que diga `responses[name]` (o `{ ok: true }`) y graba las llamadas. */
function fakeSkills(responses: Record<string, unknown> = {}) {
  const called: string[] = [];
  const run: SkillRunner = (name) => {
    called.push(name);
    return Promise.resolve({ response: responses[name] ?? { ok: true } });
  };
  return { run, called };
}

interface RunOpts {
  script: StepSource[];
  offered?: string[];
  runSkill?: SkillRunner;
  repeatLast?: boolean;
  maxLoops?: number;
  replyLanguage?: string;
  input?: Partial<AgentLoopInput>;
}

async function runLoop(o: RunOpts) {
  const provider = new ScriptedAiProvider(o.script, undefined, { repeatLast: o.repeatLast });
  const loop = new AgentLoop(provider, { maxLoops: o.maxLoops, runSkill: "runSkill" in o ? o.runSkill : fakeSkills().run });
  const events: AgentEvent[] = [];
  const history: AiMessage[] = [{ role: AiRole.USER, parts: [{ text: "[CONTEXT] hola" }] }];
  const offered = o.offered ?? ["search_contact", "get_contact", "search_knowledge"];
  const outcome = await quietLogs(() =>
    loop.run({
      input: "[CONTEXT] hola",
      history,
      tools: [{ functionDeclarations: offered.map((name) => ({ name })) }],
      offeredNames: new Set(offered),
      systemInstruction: "sys",
      ctx: CTX,
      replyLanguage: o.replyLanguage ?? "Spanish",
      onEvent: (e) => {
        events.push(e);
      },
      ...o.input,
    })
  );
  return { provider, outcome, events, history, types: events.map((e) => e.type) };
}

Deno.test("solo texto: model_call_started → text → done, una llamada", async () => {
  const { outcome, types, events, history } = await runLoop({ script: [say("Hola", usage(10, 2))] });
  assert.deepEqual(types, ["model_call_started", "text", "done"]);
  assert.deepEqual(events[1], { type: "text", text: "Hola" });
  assert.equal(outcome.text, "Hola");
  assert.equal(outcome.modelCalls, 1);
  assert.equal(outcome.cancelled, false);
  assert.equal(outcome.lastInteractionId, "int-1");
  assert.deepEqual(history.at(-1), { role: AiRole.MODEL, parts: [{ text: "Hola" }] });
  const done = events[2] as Extract<AgentEvent, { type: "done" }>;
  assert.equal(done.text, "Hola");
  assert.equal(done.modelCalls, 1);
});

Deno.test("una herramienta: eventos con etiqueta humana y el resultado vuelve como function_result", async () => {
  const skills = fakeSkills({ search_contact: [{ id: "c-1" }] });
  const { provider, types, events, outcome } = await runLoop({
    script: [callTool("search_contact", { query: "Rosa" }), say("Encontré a Rosa")],
    runSkill: skills.run,
  });
  assert.deepEqual(types, ["model_call_started", "tool_started", "tool_finished", "model_call_started", "text", "done"]);
  assert.deepEqual(events[1], { type: "tool_started", name: "search_contact", label: "Buscando contacto" });
  assert.deepEqual(events[2], { type: "tool_finished", name: "search_contact", label: "Buscando contacto", ok: true });
  assert.deepEqual(skills.called, ["search_contact"]);
  const second = provider.interactions[1].input as Record<string, unknown>[];
  assert.equal(second[0].type, "function_result");
  assert.equal(second[0].call_id, "fc-0-0");
  assert.equal(outcome.modelCalls, 2);
});

Deno.test("varias herramientas en paralelo y encadenadas: un par de eventos por llamada, en orden", async () => {
  const skills = fakeSkills();
  const { types, events, history } = await runLoop({
    script: [
      callTools([{ name: "search_contact", args: {} }, { name: "search_knowledge", args: {} }]),
      callTool("get_contact", { contact_id: "c-1" }),
      say("listo"),
    ],
    runSkill: skills.run,
  });
  assert.deepEqual(skills.called, ["search_contact", "search_knowledge", "get_contact"]);
  const toolEvents = events.filter((e) => e.type === "tool_started").map((e) => (e as { name: string }).name);
  assert.deepEqual(toolEvents, ["search_contact", "search_knowledge", "get_contact"]);
  assert.equal(types.filter((t) => t === "model_call_started").length, 3);
  // Cada vuelta deja en el historial la llamada (model) y sus respuestas (user).
  const fnResponses = history.filter((m) =>
    (m.parts as Record<string, unknown>[]).some((p) => "functionResponse" in p)
  );
  assert.equal(fnResponses.length, 2);
  assert.equal(fnResponses[0].parts.length, 2);
});

Deno.test("bug 7: herramienta no ofrecida no se ejecuta y tool_finished sale ok:false", async () => {
  // Ejecutor real: la lista blanca vive en executeSkill.
  const { provider, events } = await runLoop({
    script: [callTool("create_policy", { policy_number: "X" }), say("No puedo")],
    offered: ["search_contact"],
    runSkill: undefined,
  });
  const finished = events.find((e) => e.type === "tool_finished") as Extract<AgentEvent, { type: "tool_finished" }>;
  assert.equal(finished.name, "create_policy");
  assert.equal(finished.ok, false);
  assert.equal(finished.label, "Trabajando…");
  assert.match(JSON.stringify(provider.interactions[1].input), /Tool not available in this turn: create_policy/);
});

Deno.test("vueltas agotadas: exhausted(max_loops) y pasada de cierre con forceTextOnly", async () => {
  let calls = 0;
  const { provider, types, events, outcome } = await runLoop({
    script: [(req) => (++calls <= 3 ? callTool("search_contact") : req.forceTextOnly ? say("Resumen") : callTool("search_contact"))],
    repeatLast: true,
    maxLoops: 3,
  });
  assert.equal(provider.calls, 4);
  assert.equal(provider.interactions[3].forceTextOnly, true);
  assert.equal(provider.interactions[2].forceTextOnly, false);
  const exhausted = events.find((e) => e.type === "exhausted");
  assert.deepEqual(exhausted, { type: "exhausted", reason: "max_loops", maxLoops: 3 });
  assert.deepEqual(types.slice(-4), ["exhausted", "model_call_started", "text", "done"]);
  assert.equal(outcome.text, "Resumen");
  assert.equal(outcome.modelCalls, 4);
});

Deno.test("cierre sin texto: texto de respaldo en el historial, evento text y done", async () => {
  const { outcome, events, history } = await runLoop({
    script: [callTool("search_contact"), { empty: true }],
    repeatLast: true,
    maxLoops: 1,
  });
  assert.equal(outcome.text, EXHAUSTED_FALLBACK_TEXT);
  assert.deepEqual(history.at(-1), { role: AiRole.MODEL, parts: [{ text: EXHAUSTED_FALLBACK_TEXT }] });
  assert.deepEqual(events.at(-2), { type: "text", text: EXHAUSTED_FALLBACK_TEXT });
  assert.equal(events.at(-1)!.type, "done");
});

Deno.test("respuesta vacía: exhausted(empty_response) y pasada de cierre", async () => {
  const { provider, events, outcome } = await runLoop({ script: [{ empty: true }, say("Perdón, ¿qué necesitas?")] });
  assert.equal(provider.calls, 2);
  assert.equal(provider.interactions[1].forceTextOnly, true);
  assert.deepEqual(events.find((e) => e.type === "exhausted"), { type: "exhausted", reason: "empty_response", maxLoops: 6 });
  assert.equal(outcome.text, "Perdón, ¿qué necesitas?");
});

Deno.test("búsqueda RAG vacía fuerza texto en la vuelta siguiente", async () => {
  const { provider } = await runLoop({
    script: [callTool("search_knowledge", { query: "x" }), say("No encontré nada")],
    runSkill: fakeSkills({ search_knowledge: [] }).run,
  });
  assert.equal(provider.interactions[0].forceTextOnly, false);
  assert.equal(provider.interactions[1].forceTextOnly, true);
});

Deno.test("cancelación tras la primera herramienta: no hay segunda llamada al modelo", async () => {
  let cancel = false;
  const skills = fakeSkills();
  const run: SkillRunner = (...a) => {
    cancel = true;
    return skills.run(...a);
  };
  const { provider, outcome, types, history } = await runLoop({
    script: [callTools([{ name: "search_contact", args: {} }, { name: "get_contact", args: {} }]), say("nunca")],
    runSkill: run,
    input: { isCancelled: () => cancel },
  });
  assert.equal(provider.calls, 1);
  assert.equal(outcome.modelCalls, 1);
  assert.equal(outcome.cancelled, true);
  assert.equal(outcome.text, "");
  // La segunda herramienta no se ejecutó, pero su llamada queda emparejada en el historial.
  assert.deepEqual(skills.called, ["search_contact"]);
  const lastParts = history.at(-1)!.parts as { functionResponse: { name: string; response: { result: unknown } } }[];
  assert.equal(lastParts.length, 2);
  assert.deepEqual(lastParts[1].functionResponse.response.result, { ok: false, error: "Not executed: the turn was cancelled." });
  assert.deepEqual(types, ["model_call_started", "tool_started", "tool_finished", "cancelled"]);
});

Deno.test("cancelación con AbortSignal antes de empezar: cero llamadas al modelo", async () => {
  const ac = new AbortController();
  ac.abort();
  const { provider, outcome, events } = await runLoop({ script: [say("nunca")], input: { signal: ac.signal } });
  assert.equal(provider.calls, 0);
  assert.equal(outcome.modelCalls, 0);
  assert.equal(outcome.cancelled, true);
  assert.deepEqual(events, [{ type: "cancelled", modelCalls: 0 }]);
});

Deno.test("uso: suma prompt, completion, total, cache y thoughts de todas las llamadas", async () => {
  const { outcome } = await runLoop({
    script: [callTool("search_contact", {}, usage(100, 10, 40, 5)), say("ok", usage(200, 20, 80, 7))],
  });
  assert.deepEqual(outcome.usage, {
    promptTokens: 300,
    completionTokens: 30,
    totalTokens: 115 + 227,
    cachedTokens: 120,
    thoughtsTokens: 12,
  });
});

Deno.test("citas: se limpian del texto y quedan en citedNoteIds", async () => {
  const id = "11111111-2222-3333-4444-555555555555";
  const { outcome } = await runLoop({ script: [say(`Dato importante [[cite:${id}]]`)] });
  assert.equal(outcome.text, "Dato importante");
  assert.deepEqual([...outcome.citedNoteIds], [id]);
});

Deno.test("toolLabel: idioma inglés y etiqueta genérica", () => {
  assert.equal(toolLabel("search_contact", "English"), "Looking up contact");
  assert.equal(toolLabel("count_policies", "English"), "Working…");
  assert.equal(toolLabel("count_policies", "Spanish"), "Trabajando…");
  assert.equal(toolLabel("search_contact", "French"), "Buscando contacto");
});

// ── Guardas de herramientas ──
const GUARD_CALL = { client_name: "Patricia", due_date: "2026-11-23T09:00:00-06:00" };
async function runGuarded(mode: "log" | "enforce") {
  const skills = fakeSkills({
    search_contact: { contacts: [{ id: "c-1", fullName: "Patricia Lopez" }, { id: "c-2", fullName: "Patricia Ruiz" }] },
  });
  const warns: string[] = [];
  const orig = console.warn;
  const provider = new ScriptedAiProvider([
    callTool("search_contact", { query: "Patricia" }),
    callTool("create_reminder_for_client", GUARD_CALL),
    say("listo"),
  ]);
  const loop = new AgentLoop(provider, { runSkill: skills.run, guardsMode: mode });
  const events: AgentEvent[] = [];
  const history: AiMessage[] = [{ role: AiRole.USER, parts: [{ text: "[CONTEXT] x\n\nreagéndale la cita a Patricia" }] }];
  const offered = ["search_contact", "create_reminder_for_client"];
  console.warn = (m: unknown) => warns.push(String(m));
  try {
    await loop.run({
      input: "x", history, tools: [], offeredNames: new Set(offered), systemInstruction: "s", ctx: CTX,
      replyLanguage: "Spanish", onEvent: (e) => { events.push(e); },
    });
  } finally {
    console.warn = orig;
  }
  return { skills, warns: warns.filter((w) => w.startsWith("[GUARD]")), events, provider };
}

Deno.test("guardas en modo log: la herramienta se ejecuta y se registra would_block", async () => {
  const { skills, warns, events } = await runGuarded("log");
  assert.deepEqual(skills.called, ["search_contact", "create_reminder_for_client"]);
  assert.deepEqual(warns, ["[GUARD] would_block guard=create_before_disambiguation tool=create_reminder_for_client reason=ambiguous_contact"]);
  const fin = events.filter((e) => e.type === "tool_finished").at(-1) as Extract<AgentEvent, { type: "tool_finished" }>;
  assert.equal(fin.ok, true);
});

Deno.test("guardas en modo enforce: no se ejecuta y el modelo recibe el mensaje", async () => {
  const { skills, warns, events, provider } = await runGuarded("enforce");
  assert.deepEqual(skills.called, ["search_contact"]);
  assert.ok(warns[0].startsWith("[GUARD] blocked guard=create_before_disambiguation"));
  const fin = events.filter((e) => e.type === "tool_finished").at(-1) as Extract<AgentEvent, { type: "tool_finished" }>;
  assert.equal(fin.name, "create_reminder_for_client");
  assert.equal(fin.ok, false);
  assert.match(JSON.stringify(provider.interactions[2].input), /several contacts/);
});

Deno.test("guardas en modo off: ni evalúa ni registra", async () => {
  const skills = fakeSkills();
  const loop = new AgentLoop(new ScriptedAiProvider([callTool("search_contact"), say("ok")]), { runSkill: skills.run, guardsMode: "off" });
  await quietLogs(() => loop.run({
    input: "x", history: [{ role: AiRole.USER, parts: [{ text: "hola" }] }], tools: [], offeredNames: new Set(["search_contact"]),
    systemInstruction: "s", ctx: CTX, replyLanguage: "Spanish",
  }));
  assert.deepEqual(skills.called, ["search_contact"]);
});
