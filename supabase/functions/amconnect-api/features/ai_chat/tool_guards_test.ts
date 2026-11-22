// Guardas de herramientas: solo se decide con llamadas y resultados de
// herramientas, nunca con lo que escribió el asesor.
import assert from "node:assert/strict";
import type { AiFunctionCall } from "../../core/ai_provider.interface.ts";
import { createBeforeDisambiguation, type GuardTurnState, type ToolGuard, type ToolRecord, ToolGuards } from "./tool_guards.ts";

function turn(toolCalls: ToolRecord[] = []): GuardTurnState {
  return { toolCalls, replyLanguage: "Spanish" };
}
const call = (name: string, args: Record<string, unknown> = {}): AiFunctionCall => ({ name, args });
const rec = (name: string, args: Record<string, unknown>, result: unknown): ToolRecord => ({ name, args, result });
const blocks = (g: ToolGuard, c: AiFunctionCall, t: GuardTurnState) => g.check(c, t).verdict === "block";

const noContact = rec("search_contact", { query: "x" }, { contacts: [] });
const oneContact = (id = "c-1", fullName = "Patricia Lopez") => rec("search_contact", { query: "x" }, { contacts: [{ id, fullName }] });
const manyContacts = rec("search_contact", { query: "Villarreal" }, {
  contacts: [{ id: "c-1", fullName: "Rafael Villarreal Soto" }, { id: "c-2", fullName: "Rafael Villarreal Cruz" }],
});
const create = call("create_reminder_for_client", { client_name: "Patricia", due_date: "2026-11-23T17:00:00-06:00" });

// ── create_before_disambiguation ──
const commitment = call("create_commitment", { label: "x", quote: "y", contact_id: "c-1" });

Deno.test("g2: bloquea crear ligado a cliente con búsqueda ambigua", () => {
  const t = turn([manyContacts]);
  assert.ok(blocks(createBeforeDisambiguation, commitment, t));
  assert.ok(blocks(createBeforeDisambiguation, create, t));
  assert.ok(blocks(createBeforeDisambiguation, call("add_note_to_client", { client_name: "Villarreal", note_content: "n" }), t));
  assert.ok(blocks(createBeforeDisambiguation, call("create_policy", { contact_id: "c-1" }), t));
});

Deno.test("g2: NO bloquea sin ambigüedad, sin cliente, tras elegir o en otras herramientas", () => {
  assert.ok(!blocks(createBeforeDisambiguation, commitment, turn([oneContact()])));
  assert.ok(!blocks(createBeforeDisambiguation, commitment, turn([])));
  assert.ok(!blocks(createBeforeDisambiguation, commitment, turn([noContact])));
  assert.ok(!blocks(createBeforeDisambiguation, call("create_commitment", { label: "x", quote: "y" }), turn([manyContacts])));
  assert.ok(!blocks(createBeforeDisambiguation, call("create_reminder", { due_date: "2026-11-23" }), turn([manyContacts])));
  // luego una búsqueda con 1 resultado
  assert.ok(!blocks(createBeforeDisambiguation, commitment, turn([manyContacts, oneContact("c-1", "Rafael Villarreal Soto")])));
  // resolve_pending_task exitoso
  assert.ok(!blocks(createBeforeDisambiguation, commitment, turn([manyContacts, rec("resolve_pending_task", {}, { resolved: true })])));
  // búsqueda fallida no cuenta como ambigua ni borra la ambigüedad
  assert.ok(!blocks(createBeforeDisambiguation, commitment, turn([rec("search_contact", {}, { error: "e" })])));
  assert.ok(blocks(createBeforeDisambiguation, commitment, turn([manyContacts, rec("search_contact", {}, { error: "e" })])));
  // resolve_pending_task fallido no resuelve
  assert.ok(blocks(createBeforeDisambiguation, commitment, turn([manyContacts, rec("resolve_pending_task", {}, { ok: false, error: "x" })])));
});

Deno.test("g2: el contact_id de la llamada es el de una búsqueda de 1 resultado anterior → pasa; otro id → bloquea", () => {
  const t = turn([oneContact("c-1", "Patricia Lopez"), manyContacts]);
  assert.ok(!blocks(createBeforeDisambiguation, call("create_commitment", { contact_id: "c-1" }), t));
  assert.ok(blocks(createBeforeDisambiguation, call("create_commitment", { contact_id: "c-2" }), t));
});

Deno.test("g2: no depende de lo que escribió el asesor (un nombre completo no la desactiva)", () => {
  const t: GuardTurnState = { toolCalls: [manyContacts], replyLanguage: "Spanish", advisorWords: "es Rafael Villarreal Soto" };
  assert.ok(blocks(createBeforeDisambiguation, commitment, t));
});

// ── Runner ──
Deno.test("ToolGuards: off no evalúa, log avisa sin bloquear, enforce bloquea; el log no lleva datos", () => {
  const t = turn([manyContacts]);
  const warns: string[] = [];
  const orig = console.warn;
  console.warn = (m: string) => warns.push(String(m));
  try {
    assert.equal(new ToolGuards("off").check(create, t), null);
    assert.equal(warns.length, 0);
    assert.equal(new ToolGuards("log", [createBeforeDisambiguation]).check(create, t), null);
    assert.deepEqual(warns, ["[GUARD] would_block guard=create_before_disambiguation tool=create_reminder_for_client reason=ambiguous_contact"]);
    warns.length = 0;
    const b = new ToolGuards("enforce", [createBeforeDisambiguation]).check(create, t);
    assert.equal(b?.guard, "create_before_disambiguation");
    assert.match(b!.messageForModel, /ask the advisor which/);
    assert.match(warns[0], /^\[GUARD\] blocked guard=create_before_disambiguation/);
    assert.ok(!warns.join().includes("Patricia"));
    // una guarda que truena no tumba la herramienta
    const boom: ToolGuard = { name: "boom", check() { throw new Error("x"); } };
    assert.equal(new ToolGuards("enforce", [boom]).check(create, t), null);
  } finally {
    console.warn = orig;
  }
});
