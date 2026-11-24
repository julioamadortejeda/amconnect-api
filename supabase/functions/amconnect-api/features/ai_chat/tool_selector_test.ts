// ToolSelector: modos by_domain / all, ALWAYS_ACTIVE, exclusión de
// resolve_pending_task, fuentes de idioma, dominios de ingesta y lista blanca.
import "../../shared/testing/test_env.ts";
import assert from "node:assert/strict";
import { AiRole, type AiMessage, type IAiProvider } from "../../core/ai_provider.interface.ts";
import type { ToolSelectionMode } from "../../shared/assistant.config.ts";
import { AVAILABLE_DOMAINS, POLICY_INGESTION_DOMAINS } from "./chat_turn.ts";
import { DomainToolSelector, type ToolSelectionInput } from "./tool_selector.ts";

function provider(classified: { domains: string[]; language?: string; usage?: unknown }) {
  const calls: string[] = [];
  const p = {
    classifyMessage: (m: string) => {
      calls.push(m);
      return Promise.resolve(classified);
    },
  } as unknown as IAiProvider;
  return { p, calls };
}

function input(over: Partial<ToolSelectionInput> = {}): ToolSelectionInput {
  return { message: "hola", pendingTasks: [], sessionType: "chat", history: [], ...over };
}

async function withQuietWarn<T>(fn: () => Promise<T>, sink: string[] = []): Promise<T> {
  const warn = console.warn;
  console.warn = (m: string) => sink.push(String(m));
  try {
    return await fn();
  } finally {
    console.warn = warn;
  }
}

async function select(
  mode: ToolSelectionMode,
  classified: { domains: string[]; language?: string; usage?: unknown },
  over: Partial<ToolSelectionInput> = {},
) {
  const { p, calls } = provider(classified);
  const sel = await withQuietWarn(() => new DomainToolSelector(p, mode).select(input(over)));
  return { sel, calls };
}

const names = (sel: { tools: { functionDeclarations: { name?: string }[] }[] }) =>
  sel.tools[0].functionDeclarations.map((d) => d.name);

Deno.test("by_domain: llama al clasificador y siempre activa contact, pending_task y knowledge", async () => {
  const { sel, calls } = await select("by_domain", { domains: ["catalog"] });
  assert.equal(calls.length, 1);
  for (const d of ["contact", "pending_task", "knowledge", "catalog"]) assert.ok(sel.activeDomains.includes(d), d);
  assert.ok(!sel.activeDomains.includes("policy"));
  assert.ok(sel.offeredNames.size > 0);
});

Deno.test("by_domain: la pantalla activa fuerza su dominio", async () => {
  const { sel } = await select("by_domain", { domains: ["catalog"] }, { context: { type: "policy", id: "x" } as never });
  assert.ok(sel.activeDomains.includes("policy"));
});

Deno.test("by_domain: devuelve el uso del clasificador", async () => {
  const usage = { promptTokens: 5, completionTokens: 1, totalTokens: 6 };
  const { sel } = await select("by_domain", { domains: ["reminder"], usage });
  assert.deepEqual(sel.classifyUsage, usage);
});

Deno.test("all: no llama al clasificador, usa todos los dominios y no hay classifyUsage", async () => {
  const { sel, calls } = await select("all", { domains: [] });
  assert.equal(calls.length, 0);
  assert.deepEqual(sel.activeDomains, AVAILABLE_DOMAINS);
  assert.equal(sel.classifyUsage, undefined);
});

Deno.test("resolve_pending_task: excluida sin tareas pendientes, ofrecida con ellas", async () => {
  const sin = await select("by_domain", { domains: ["contact"] });
  assert.ok(!names(sin.sel).includes("resolve_pending_task"));
  assert.ok(!sin.sel.offeredNames.has("resolve_pending_task"));
  const con = await select("by_domain", { domains: ["contact"] }, { pendingTasks: [{ id: "t1" }] });
  assert.ok(names(con.sel).includes("resolve_pending_task"));
  assert.ok(con.sel.offeredNames.has("resolve_pending_task"));
});

Deno.test("lista blanca: coincide exactamente con los nombres declarados", async () => {
  const { sel } = await select("all", { domains: [] });
  assert.deepEqual([...sel.offeredNames].sort(), (names(sel) as string[]).sort());
});

Deno.test("policy_ingestion: dominios propios, sin clasificador y sin log [TOOLS]", async () => {
  const { p, calls } = provider({ domains: ["contact"] });
  const logs: string[] = [];
  const sel = await withQuietWarn(
    () => new DomainToolSelector(p, "by_domain").select(input({ sessionType: "policy_ingestion" })),
    logs,
  );
  assert.deepEqual(sel.activeDomains, POLICY_INGESTION_DOMAINS);
  assert.equal(calls.length, 0);
  assert.equal(logs.filter((l) => l.startsWith("[TOOLS]")).length, 0);
});

Deno.test("by_domain emite el log [TOOLS] con modo, conteo e idioma", async () => {
  const { p } = provider({ domains: [], language: "English" });
  const logs: string[] = [];
  await withQuietWarn(() => new DomainToolSelector(p, "by_domain").select(input()), logs);
  assert.match(logs[0], /^\[TOOLS\] mode=by_domain count=\d+ lang=English langSource=detected moveExisting=false removed=0$/);
});

Deno.test("idioma by_domain: el clasificador manda; sin él cae al historial; sin historial al locale", async () => {
  const detected = await select("by_domain", { domains: [], language: "English" }, { advisorLocale: "es" });
  assert.equal(detected.sel.replyLanguage, "English");
  assert.equal(detected.sel.langSource, "detected");

  const history: AiMessage[] = [{ role: AiRole.USER, parts: [{ text: "[CONTEXT] x | Reply language: English\n\nhi" }] }];
  const fromHistory = await select("by_domain", { domains: [] }, { history, advisorLocale: "es" });
  assert.equal(fromHistory.sel.replyLanguage, "English");
  assert.equal(fromHistory.sel.langSource, "fallback");

  const fromLocale = await select("by_domain", { domains: [] }, { advisorLocale: "en" });
  assert.equal(fromLocale.sel.replyLanguage, "English");
  assert.equal(fromLocale.sel.langSource, "fallback");
});

Deno.test("idioma all: detecta localmente el mensaje y respeta el fallback", async () => {
  const es = await select("all", { domains: [] }, { message: "¿cuál es la póliza de mi cliente?", advisorLocale: "en" });
  assert.equal(es.sel.replyLanguage, "Spanish");
  assert.equal(es.sel.langSource, "detected");
  const short = await select("all", { domains: [] }, { message: "ok", advisorLocale: "en" });
  assert.equal(short.sel.replyLanguage, "English");
  assert.equal(short.sel.langSource, "fallback");
});

// ─── moveExisting (el clasificador detecta "mover algo que ya existe") ──────

const CREATION = ["create_reminder", "create_reminder_for_client", "create_commitment", "create_contact"];

Deno.test("moveExisting=true: quita SOLO las herramientas que crean registros (create_*), también de la lista blanca", async () => {
  const base = await select("by_domain", { domains: ["reminder"], moveExisting: false } as never);
  const moved = await select("by_domain", { domains: ["reminder"], moveExisting: true } as never);
  assert.ok(!names(moved.sel).some((n) => n!.startsWith("create_")), "ninguna create_* con moveExisting");
  for (const n of CREATION) {
    assert.ok(names(base.sel).includes(n), `${n} se ofrece sin moveExisting`);
    assert.ok(!names(moved.sel).includes(n), `${n} no se ofrece con moveExisting`);
    assert.ok(!moved.sel.offeredNames.has(n), `${n} fuera de la lista blanca`);
  }
  for (const n of ["reschedule_reminder", "update_reminder", "search_reminders", "get_upcoming_reminders", "search_contact"]) {
    assert.ok(names(moved.sel).includes(n), `${n} se conserva`);
  }
  assert.deepEqual(names(base.sel).filter((n) => !n!.startsWith("create_")), names(moved.sel));
  assert.deepEqual([...moved.sel.offeredNames].sort(), (names(moved.sel) as string[]).sort());
  assert.equal(moved.sel.moveExisting, true);
  assert.equal(base.sel.moveExisting, false);
});

Deno.test("moveExisting ausente del clasificador = false y no recorta nada", async () => {
  const { sel } = await select("by_domain", { domains: ["reminder"] });
  assert.equal(sel.moveExisting, false);
  assert.ok(sel.offeredNames.has("create_reminder_for_client"));
});

Deno.test("moveExisting se registra en el log [TOOLS]", async () => {
  const logs: string[] = [];
  const { p } = provider({ domains: ["reminder"], moveExisting: true } as never);
  await withQuietWarn(() => new DomainToolSelector(p, "by_domain").select(input()), logs);
  assert.ok(logs.some((l) => l.includes("[TOOLS]") && l.includes("moveExisting=true removed=")), logs.join("|"));
});

Deno.test("modo all: sin clasificador, moveExisting no aplica y se ofrecen las herramientas de crear", async () => {
  const { sel, calls } = await select("all", { domains: [], moveExisting: true } as never);
  assert.equal(calls.length, 0);
  assert.equal(sel.moveExisting, false);
  assert.ok(sel.offeredNames.has("create_reminder"));
});
