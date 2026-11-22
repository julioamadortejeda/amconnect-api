// Guardas de herramientas: casos positivos y negativos (español e inglés),
// con los falsos positivos que importan.
import assert from "node:assert/strict";
import type { AiFunctionCall } from "../../core/ai_provider.interface.ts";
import {
  createBeforeDisambiguation,
  type GuardTurnState,
  hasExplicitCreateRequest,
  hasRescheduleVerb,
  inventedTime,
  rescheduleWithoutAppointment,
  type ToolGuard,
  type ToolRecord,
  timesMentioned,
  ToolGuards,
} from "./tool_guards.ts";

function turn(advisorWords: string, toolCalls: ToolRecord[] = [], extra: Partial<GuardTurnState> = {}): GuardTurnState {
  return { toolCalls, advisorWords, sessionAdvisorWords: advisorWords, priorAssistantText: "", replyLanguage: "Spanish", ...extra };
}
const call = (name: string, args: Record<string, unknown> = {}): AiFunctionCall => ({ name, args });
const rec = (name: string, args: Record<string, unknown>, result: unknown): ToolRecord => ({ name, args, result });
const blocks = (g: ToolGuard, c: AiFunctionCall, t: GuardTurnState) => g.check(c, t).verdict === "block";

const noContact = rec("search_contact", { query: "x" }, { contacts: [] });
const oneContact = (id = "c-1", fullName = "Patricia Lopez") => rec("search_contact", { query: "x" }, { contacts: [{ id, fullName }] });
const manyContacts = rec("search_contact", { query: "Villarreal" }, {
  contacts: [{ id: "c-1", fullName: "Rafael Villarreal Soto" }, { id: "c-2", fullName: "Rafael Villarreal Cruz" }],
});
const emptyAgenda = rec("get_upcoming_reminders", { contact_id: "c-1" }, { reminders: [], queriedRange: {} });
const create = call("create_reminder_for_client", { client_name: "Patricia", due_date: "2026-11-23T17:00:00-06:00" });

// ── Guarda 1 ──
Deno.test("g1: verbos de reagendar y de crear", () => {
  for (const t of ["reagéndale a Patricia", "muévele la cita", "cambia la cita para el jueves", "pásala a las 5", "pospón la junta", "reschedule Patricia", "move it to Friday", "postpone the call", "change it to 5pm"]) {
    assert.ok(hasRescheduleVerb(t), t);
  }
  for (const t of ["recuérdame llamar a Juan", "agéndale una cita mañana", "crea un recordatorio", "schedule a new meeting", "create a reminder"]) {
    assert.ok(!hasRescheduleVerb(t) || hasExplicitCreateRequest(t), t);
  }
  assert.ok(hasExplicitCreateRequest("no tiene cita pero agéndale una mañana a las 5"));
  assert.ok(!hasExplicitCreateRequest("reagéndale la cita de Patricia"));
});

Deno.test("g1: bloquea reagendar cuando no hay cita (búsqueda acotada vacía)", () => {
  const t = turn("reagéndale la cita a Patricia para mañana", [oneContact(), emptyAgenda]);
  assert.ok(blocks(rescheduleWithoutAppointment, create, t));
  assert.ok(blocks(rescheduleWithoutAppointment, call("create_reminder", { due_date: "2026-11-23T00:00:00-06:00" }), t));
});

Deno.test("g1: bloquea en inglés y con search_reminders vacío", () => {
  const t = turn("reschedule Patricia's appointment to tomorrow", [rec("search_reminders", { query: "Patricia" }, [])]);
  assert.ok(blocks(rescheduleWithoutAppointment, create, t));
});

Deno.test("g1: agenda sin acotar con citas de otra persona sí bloquea cuando la persona se conoce", () => {
  const agenda = rec("get_upcoming_reminders", {}, { reminders: [{ id: "r1", contactId: "c-9", contact: { fullName: "Mario Perez" } }] });
  assert.ok(blocks(rescheduleWithoutAppointment, create, turn("muévele la cita a Patricia", [oneContact(), agenda])));
});

Deno.test("g1: NO bloquea si el asesor pide crear una nueva", () => {
  const t = turn("no tiene cita pero agéndale una mañana a las 5", [oneContact(), emptyAgenda]);
  assert.ok(!blocks(rescheduleWithoutAppointment, create, t));
  assert.ok(!blocks(rescheduleWithoutAppointment, create, turn("she has no appointment, schedule a new one at 5", [emptyAgenda])));
});

Deno.test("g1: NO bloquea si hay cita de esa persona, sin búsqueda, sin verbo o error en la búsqueda", () => {
  const found = rec("search_reminders", { query: "Patricia" }, [{ id: "r1", contactId: "c-1", contact: { fullName: "Patricia Lopez" } }]);
  assert.ok(!blocks(rescheduleWithoutAppointment, create, turn("reagéndale a Patricia", [oneContact(), found])));
  const scoped = rec("get_upcoming_reminders", { contact_id: "c-1" }, { reminders: [{ id: "r1" }] });
  assert.ok(!blocks(rescheduleWithoutAppointment, create, turn("reagéndale a Patricia", [oneContact(), scoped])));
  assert.ok(!blocks(rescheduleWithoutAppointment, create, turn("reagéndale a Patricia", [oneContact()])));
  assert.ok(!blocks(rescheduleWithoutAppointment, create, turn("recuérdale a Patricia llamar", [oneContact(), emptyAgenda])));
  const failed = rec("search_reminders", {}, { error: "boom" });
  assert.ok(!blocks(rescheduleWithoutAppointment, create, turn("reagéndale a Patricia", [failed])));
  // otras herramientas no se tocan
  assert.ok(!blocks(rescheduleWithoutAppointment, call("update_reminder", { reminder_id: "r" }), turn("reagéndale", [emptyAgenda])));
  // agenda sin acotar con cosas y persona desconocida: ante la duda, pasa
  const some = rec("get_upcoming_reminders", {}, { reminders: [{ id: "r1" }] });
  assert.ok(!blocks(rescheduleWithoutAppointment, call("create_reminder", { due_date: "2026-11-23" }), turn("muévela", [some])));
});

// ── Guarda 2 ──
const commitment = call("create_commitment", { label: "x", quote: "y", contact_id: "c-1" });

Deno.test("g2: bloquea crear ligado a cliente con búsqueda ambigua", () => {
  const t = turn("anota que Villarreal me va a mandar sus resultados", [manyContacts]);
  assert.ok(blocks(createBeforeDisambiguation, commitment, t));
  assert.ok(blocks(createBeforeDisambiguation, create, t));
  assert.ok(blocks(createBeforeDisambiguation, call("add_note_to_client", { client_name: "Villarreal", note_content: "n" }), t));
  assert.ok(blocks(createBeforeDisambiguation, call("create_policy", { contact_id: "c-1" }), t));
});

Deno.test("g2: NO bloquea sin ambigüedad, sin cliente, tras elegir o en otras herramientas", () => {
  assert.ok(!blocks(createBeforeDisambiguation, commitment, turn("x", [oneContact()])));
  assert.ok(!blocks(createBeforeDisambiguation, commitment, turn("x", [])));
  assert.ok(!blocks(createBeforeDisambiguation, commitment, turn("x", [noContact])));
  assert.ok(!blocks(createBeforeDisambiguation, call("create_commitment", { label: "x", quote: "y" }), turn("x", [manyContacts])));
  assert.ok(!blocks(createBeforeDisambiguation, call("create_reminder", { due_date: "2026-11-23" }), turn("x", [manyContacts])));
  // luego una búsqueda con 1 resultado
  assert.ok(!blocks(createBeforeDisambiguation, commitment, turn("x", [manyContacts, oneContact("c-1", "Rafael Villarreal Soto")])));
  // resolve_pending_task
  assert.ok(!blocks(createBeforeDisambiguation, commitment, turn("x", [manyContacts, rec("resolve_pending_task", {}, { resolved: true })])));
  // el asesor escribió el nombre completo de uno
  assert.ok(!blocks(createBeforeDisambiguation, commitment, turn("es Rafael Villarreal Soto", [manyContacts])));
  // búsqueda fallida no cuenta como ambigua ni borra la ambigüedad
  assert.ok(!blocks(createBeforeDisambiguation, commitment, turn("x", [rec("search_contact", {}, { error: "e" })])));
  assert.ok(blocks(createBeforeDisambiguation, commitment, turn("x", [manyContacts, rec("search_contact", {}, { error: "e" })])));
});

// ── Guarda 3 ──
const at = (hhmm: string, name = "create_reminder") => call(name, { due_date: `2026-11-23T${hhmm}:00-06:00`, reminder_id: "r1" });

Deno.test("g3: extracción de horas", () => {
  const has = (txt: string, ...hh: string[]) => hh.forEach((h) => assert.ok(timesMentioned(txt).has(h), `${txt} -> ${h}`));
  has("a las 5", "05:00", "17:00");
  has("a las 5pm", "17:00");
  has("a las 5 p.m.", "17:00");
  has("at 5 pm", "17:00");
  has("17:00", "17:00");
  has("a las 17 hrs", "17:00");
  has("a las 5:30", "05:30", "17:30");
  has("a las cinco y media", "05:30", "17:30");
  has("a las tres y cuarto", "03:15", "15:15");
  has("a las seis menos cuarto", "05:45", "17:45");
  has("a medio día", "12:00");
  has("al mediodía", "12:00");
  has("at noon", "12:00");
  has("a las 12", "12:00");
  has("a las 9 am", "09:00");
  assert.ok(!timesMentioned("a las 5pm").has("05:00"));
  assert.equal(timesMentioned("el 15 de marzo").size, 0);
  assert.equal(timesMentioned("recuérdame llamar a Juan mañana").size, 0);
});

Deno.test("g3: bloquea hora que el asesor no dijo", () => {
  assert.ok(blocks(inventedTime, at("09:00"), turn("recuérdame llamar a Juan mañana")));
  assert.ok(blocks(inventedTime, at("09:00"), turn("a las 5 llamar a Juan")));
  assert.ok(blocks(inventedTime, at("09:00", "create_reminder_for_client"), turn("remind me to call Juan tomorrow")));
  assert.ok(blocks(inventedTime, at("10:30", "update_reminder"), turn("pásala al jueves", [rec("search_reminders", {}, [{ id: "r1", dueDate: "2026-11-20T17:00:00-06:00" }])])));
});

Deno.test("g3: NO bloquea horas dichas, relativas, de franja o solo fecha", () => {
  assert.ok(!blocks(inventedTime, at("17:00"), turn("recuérdame mañana a las 5")));
  assert.ok(!blocks(inventedTime, at("17:00"), turn("recuérdame mañana a las 5pm")));
  assert.ok(!blocks(inventedTime, at("05:00"), turn("remind me tomorrow at 5 am")));
  assert.ok(!blocks(inventedTime, at("17:30"), turn("mañana a las cinco y media")));
  assert.ok(!blocks(inventedTime, at("12:00"), turn("recuérdame ir al aeropuerto mañana a medio día")));
  assert.ok(!blocks(inventedTime, at("00:00"), turn("recuérdame llamar a Juan mañana")));
  assert.ok(!blocks(inventedTime, call("create_reminder", { due_date: "2026-11-23" }), turn("llamar a Juan")));
  assert.ok(!blocks(inventedTime, at("16:00"), turn("recuérdame llamar a Juan mañana por la tarde")));
  assert.ok(!blocks(inventedTime, at("08:00"), turn("remind me in the morning to call")));
  assert.ok(!blocks(inventedTime, at("15:42"), turn("avísame en 2 horas")));
  assert.ok(!blocks(inventedTime, at("14:00"), turn("remind me in an hour and a half")));
  assert.ok(!blocks(inventedTime, call("delete_reminder", {}), turn("x")));
});

Deno.test("g3: caso del aeropuerto — medio día y 2 horas después", () => {
  const words = "recuérdame ir al aeropuerto mañana a medio día y 2 horas después recoger mi pedido";
  assert.ok(!blocks(inventedTime, at("12:00"), turn(words)));
  assert.ok(!blocks(inventedTime, at("14:00"), turn(words)));
});

Deno.test("g3: José mueve el día y conserva 17:00 (update_reminder)", () => {
  const seen = rec("search_reminders", { query: "José" }, [{ id: "r1", dueDate: "2026-11-20T17:00:00-06:00" }]);
  assert.ok(!blocks(inventedTime, at("17:00", "update_reminder"), turn("muévele la cita a José para el viernes", [seen])));
  // sin saber cuál era el original, pasa
  assert.ok(!blocks(inventedTime, at("17:00", "update_reminder"), turn("muévela al viernes")));
});

Deno.test("g3: el asesor aceptó la hora que propuso el asistente / la dijo antes", () => {
  assert.ok(!blocks(inventedTime, at("17:00"), turn("sí", [], { priorAssistantText: "¿Te lo agendo a las 5 pm?" })));
  assert.ok(!blocks(inventedTime, at("17:00"), turn("mañana", [], { sessionAdvisorWords: "a las 5\nmañana" })));
});

// ── Runner ──
Deno.test("ToolGuards: off no evalúa, log avisa sin bloquear, enforce bloquea; el log no lleva datos", () => {
  const t = turn("reagéndale a Patricia", [oneContact(), emptyAgenda]);
  const warns: string[] = [];
  const orig = console.warn;
  console.warn = (m: string) => warns.push(String(m));
  try {
    assert.equal(new ToolGuards("off").check(create, t), null);
    assert.equal(warns.length, 0);
    assert.equal(new ToolGuards("log", [rescheduleWithoutAppointment]).check(create, t), null);
    assert.deepEqual(warns, ["[GUARD] would_block guard=reschedule_without_appointment tool=create_reminder_for_client reason=no_appointment_found"]);
    warns.length = 0;
    const b = new ToolGuards("enforce", [rescheduleWithoutAppointment, inventedTime]).check(create, t);
    assert.equal(b?.guard, "reschedule_without_appointment");
    assert.match(b!.messageForModel, /ask whether/);
    assert.match(warns[0], /^\[GUARD\] blocked guard=reschedule_without_appointment/);
    assert.ok(!warns.join().includes("Patricia"));
    // una guarda que truena no tumba la herramienta
    const boom: ToolGuard = { name: "boom", check() { throw new Error("x"); } };
    assert.equal(new ToolGuards("enforce", [boom]).check(create, t), null);
  } finally {
    console.warn = orig;
  }
});
