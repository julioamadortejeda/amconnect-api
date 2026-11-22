// Guardas deterministas sobre las herramientas de escritura (Fase 2, paso 3).
//
// Se revisan en AgentLoop justo antes de ejecutar una herramienta. Cada guarda
// es una función PURA: recibe la llamada y lo que pasó EN ESTE TURNO y decide
// "allow" o "block". Ante la duda siempre "allow": un falso positivo le
// estorba al asesor, un falso negativo es lo que ya pasaba antes.
//
// Modo (shared/assistant.config.ts → TOOL_GUARDS_MODE):
//   off      no se evalúa; log   registra `would_block` y deja pasar;
//   enforce  bloquea y el modelo recibe `messageForModel` como resultado.
//
// Los logs NO llevan texto del asesor, argumentos ni nombres: solo guarda,
// herramienta y código.
import type { AiFunctionCall } from "../../core/ai_provider.interface.ts";
import type { ToolGuardsMode } from "../../shared/assistant.config.ts";

// ─── Tipos ─────────────────────────────────────────────────────────────────

/** Una herramienta ya ejecutada en este turno, con su resultado. */
export interface ToolRecord {
  name: string;
  args: Record<string, unknown>;
  result: unknown;
}

/** Lo que el loop sabe de ESTE turno cuando se va a ejecutar una herramienta. */
export interface GuardTurnState {
  /** Herramientas ejecutadas antes en el turno, en orden. */
  toolCalls: ToolRecord[];
  /** Lo que el asesor escribió en el mensaje de ESTE turno (sin [CONTEXT]). */
  advisorWords: string;
  /** Todo lo que el asesor ha escrito en la sesión (para horas ya dichas antes). */
  sessionAdvisorWords: string;
  /** Último texto del asistente ANTES de este turno (el asesor pudo aceptar su propuesta). */
  priorAssistantText: string;
  replyLanguage: string;
}

export type GuardVerdict =
  | { verdict: "allow" }
  | { verdict: "block"; reason: string; messageForModel: string };

export interface ToolGuard {
  name: string;
  check(call: AiFunctionCall, turn: GuardTurnState): GuardVerdict;
}

const ALLOW: GuardVerdict = { verdict: "allow" };

// ─── Utilidades de texto y de resultados ───────────────────────────────────

/** Minúsculas y sin acentos, para comparar texto escrito de cualquier manera. */
export function norm(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function asRecord(v: unknown): Record<string, unknown> | null {
  return v && typeof v === "object" && !Array.isArray(v) ? v as Record<string, unknown> : null;
}

/** Los resultados casi siempre son objetos, pero un string JSON también se lee. */
function parseResult(result: unknown): unknown {
  if (typeof result !== "string") return result;
  try {
    return JSON.parse(result);
  } catch {
    return result;
  }
}

function hasError(result: unknown): boolean {
  const r = asRecord(result);
  return !!r && (r.ok === false || "error" in r);
}

function str(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v : undefined;
}

// ─── Guarda 1: reagendar sin cita ──────────────────────────────────────────

const REMINDER_LOOKUPS = new Set(["search_reminders", "get_upcoming_reminders"]);

// Verbos de mover algo que ya existe (texto normalizado, sin acentos).
const RESCHEDULE_RE = new RegExp(
  [
    String.raw`\breagend\w*`,
    String.raw`\bmuev\w*`,
    String.raw`\bmov(?:er|erl\w*|amos|ido)\b`,
    String.raw`\bcambi\w*[^.\n]*\bpara\b`,
    String.raw`\bpas(?:a|ala|alo|ale|alas|alos|ar|en)\s+a\b`,
    String.raw`\bposp\w*`,
    String.raw`\baplaz\w*`,
    String.raw`\badelant(?:a|ar|ala|alo)\b`,
    String.raw`\bresched\w*`,
    String.raw`\bmove\b`,
    String.raw`\bpostpone\w*`,
    String.raw`\bpush\w*\s+(?:it\s+|this\s+|that\s+)?back`,
    String.raw`\bchang\w*[^.\n]*\bto\b`,
  ].join("|"),
);

// Pedido EXPLÍCITO de crear algo nuevo. `\b` delante de "agend" a propósito:
// "reagéndale" no es un pedido de crear.
const EXPLICIT_CREATE_RE = new RegExp(
  [
    String.raw`\bagend\w*\s+(?:una|un|nueva|nuevo|otra|otro)\b`,
    String.raw`\bcre(?:a|ar|ame|ale|alo|alas)\b`,
    String.raw`\bhaz(?:me|le)?\s+(?:una|un)\b`,
    String.raw`\bprograma(?:r|me|le)?\s+(?:una|un)\b`,
    String.raw`\b(?:nueva|nuevo|otra|otro)\s+(?:cita|recordatorio|reunion|llamada|junta)\b`,
    String.raw`\bschedule\s+(?:a\s+)?(?:new|another|an?)\b`,
    String.raw`\bcreate\b`,
    String.raw`\badd\s+(?:a\s+)?(?:new\s+)?(?:reminder|appointment|meeting)\b`,
    String.raw`\bnew\s+(?:appointment|meeting|reminder|call)\b`,
    String.raw`\bset\s+(?:up\s+)?(?:a\s+)?(?:new\s+)?(?:reminder|appointment|meeting)\b`,
  ].join("|"),
);

export function hasRescheduleVerb(advisorWords: string): boolean {
  return RESCHEDULE_RE.test(norm(advisorWords));
}

export function hasExplicitCreateRequest(advisorWords: string): boolean {
  return EXPLICIT_CREATE_RE.test(norm(advisorWords));
}

/** Recordatorios de un resultado de búsqueda/agenda; null si no es un resultado usable. */
function reminderItems(result: unknown): Record<string, unknown>[] | null {
  const r = parseResult(result);
  const toRecords = (a: unknown[]) => a.map(asRecord).filter((x): x is Record<string, unknown> => !!x);
  if (Array.isArray(r)) return toRecords(r);
  const o = asRecord(r);
  if (!o || hasError(o) || !Array.isArray(o.reminders)) return null;
  return toRecords(o.reminders);
}

/** Contactos de un resultado de search_contact; null si no es un resultado usable. */
function contactMatches(result: unknown): { id: string; fullName: string }[] | null {
  const o = asRecord(parseResult(result));
  if (!o || hasError(o) || !Array.isArray(o.contacts)) return null;
  return o.contacts.map(asRecord)
    .filter((c): c is Record<string, unknown> => !!c)
    .map((c) => ({ id: String(c.id ?? ""), fullName: String(c.fullName ?? "") }));
}

/** Contacto único que search_contact resolvió en este turno (el último, si dio 1 solo). */
function resolvedContact(turn: GuardTurnState): { id: string; fullName: string } | null {
  const last = [...turn.toolCalls].reverse().find((t) => t.name === "search_contact");
  const matches = last ? contactMatches(last.result) : null;
  return matches && matches.length === 1 ? matches[0] : null;
}

function nameTokens(name: string): string[] {
  return norm(name).split(/[^a-z0-9ñ]+/).filter((t) => t.length >= 3);
}

export const rescheduleWithoutAppointment: ToolGuard = {
  name: "reschedule_without_appointment",
  check(call, turn) {
    if (call.name !== "create_reminder" && call.name !== "create_reminder_for_client") return ALLOW;
    if (!hasRescheduleVerb(turn.advisorWords) || hasExplicitCreateRequest(turn.advisorWords)) return ALLOW;

    // Solo cuentan las búsquedas de recordatorios que de verdad respondieron.
    const lookups = turn.toolCalls
      .filter((t) => REMINDER_LOOKUPS.has(t.name))
      .map((rec) => ({ rec, items: reminderItems(rec.result) }))
      .filter((l): l is { rec: ToolRecord; items: Record<string, unknown>[] } => l.items !== null);
    if (lookups.length === 0) return ALLOW;

    // ¿De quién es la cita? Si no se puede saber, una agenda con cosas cuenta como "puede ser".
    const resolved = resolvedContact(turn);
    const ids = new Set([str(call.args.contact_id), resolved?.id].filter((x): x is string => !!x));
    const tokens = new Set(
      [str(call.args.client_name), resolved?.fullName].flatMap((n) => (n ? nameTokens(n) : [])),
    );
    const personKnown = ids.size > 0 || tokens.size > 0;

    const someAppointmentExists = lookups.some(({ rec, items }) => {
      if (items.length === 0) return false;
      if (str(rec.args.contact_id)) return true; // ya venía acotada a una persona
      if (!personKnown) return true;
      return items.some((it) => {
        if (typeof it.contactId === "string" && ids.has(it.contactId)) return true;
        const full = str(asRecord(it.contact)?.fullName);
        return !!full && nameTokens(full).some((t) => tokens.has(t));
      });
    });
    if (someAppointmentExists) return ALLOW;

    return {
      verdict: "block",
      reason: "no_appointment_found",
      messageForModel: "Not executed: the lookup in this turn found no existing appointment or reminder to move, " +
        "so there is nothing to reschedule. Do not create a new one on your own. Tell the advisor there is no " +
        "appointment to move and ask whether they want to create one and at what time.",
    };
  },
};

// ─── Guarda 2: crear antes de desambiguar ──────────────────────────────────

function createsClientLinkedRecord(call: AiFunctionCall): boolean {
  switch (call.name) {
    case "create_reminder_for_client":
    case "add_note_to_client":
      return true;
    case "create_commitment":
    case "create_policy":
      return !!str(call.args.contact_id);
    default:
      return false;
  }
}

/** El asesor escribió el nombre completo de exactamente uno de los candidatos. */
function advisorNamedOne(matches: { fullName: string }[], advisorWords: string): boolean {
  const words = new Set(norm(advisorWords).split(/[^a-z0-9ñ]+/).filter(Boolean));
  const named = matches.filter((m) => {
    const toks = nameTokens(m.fullName);
    return toks.length >= 2 && toks.every((t) => words.has(t));
  });
  return named.length === 1;
}

export const createBeforeDisambiguation: ToolGuard = {
  name: "create_before_disambiguation",
  check(call, turn) {
    if (!createsClientLinkedRecord(call)) return ALLOW;

    // Lo último que pasó con la identidad del cliente en este turno.
    let ambiguous: { id: string; fullName: string }[] | null = null;
    for (const t of turn.toolCalls) {
      if (t.name === "resolve_pending_task") {
        if (!hasError(parseResult(t.result))) ambiguous = null;
      } else if (t.name === "search_contact") {
        const m = contactMatches(t.result);
        if (m === null) continue; // búsqueda fallida: no dice nada
        ambiguous = m.length > 1 ? m : null;
      }
    }
    if (!ambiguous) return ALLOW;
    if (advisorNamedOne(ambiguous, turn.advisorWords)) return ALLOW;

    return {
      verdict: "block",
      reason: "ambiguous_contact",
      messageForModel: "Not executed: the last client search in this turn returned several contacts and the " +
        "advisor has not chosen one yet. Do not pick one yourself. List the matching clients and ask the " +
        "advisor which one they mean; create the record only after they answer.",
    };
  },
};

// ─── Guarda 3: hora inventada ──────────────────────────────────────────────

const NUM_WORDS: Record<string, number> = {
  una: 1, un: 1, uno: 1, dos: 2, tres: 3, cuatro: 4, cinco: 5, seis: 6, siete: 7, ocho: 8, nueve: 9,
  diez: 10, once: 11, doce: 12,
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, eleven: 11,
  twelve: 12,
};
const WORD_ALT = Object.keys(NUM_WORDS).join("|");
const MARKER = String.raw`(am|pm|a\.m\.?|p\.m\.?)`;

const HM_RE = new RegExp(String.raw`(?<![\d:.\/-])(\d{1,2}):(\d{2})(?!\d)\s*${MARKER}?`, "g");
const MARKED_RE = new RegExp(String.raw`(?<![\d:.\/-])(\d{1,2})\s*(?:${MARKER}|(?:hrs?|hs|h)\b)`, "g");
const PREP_RE = new RegExp(
  String.raw`\b(?:a|de|las?|at|around|about|by|before|after|until|hasta|desde|para|from|to|como|tipo)\s+(?:las?\s+)?` +
    String.raw`(\d{1,2}|${WORD_ALT})(?::(\d{2}))?(?![\d:])(?:\s*y\s*(media|cuarto|\d{2})|\s*menos\s*(cuarto|\d{1,2}))?(?:\s*${MARKER})?`,
  "g",
);
const NOON_RE = /\b(?:medio\s?dia|mediodia|noon|midday)\b/;
const MIDNIGHT_RE = /\b(?:medianoche|media\s+noche|midnight)\b/;

// Horas "calculadas" por el modelo: no se pueden verificar contra un HH:MM.
const RELATIVE_RE = new RegExp(
  [
    String.raw`(?:\ben|\bdentro\s+de|\bin)\s+(?:[a-z0-9]+\s+)?(?:y\s+media\s+)?(?:horas?|hrs?|minutos?|mins?|hours?|minutes?)\b`,
    String.raw`\b(?:horas?|minutos?|hours?|minutes?)\s+(?:despues|mas\s+tarde|later|after|from\s+now)\b`,
    String.raw`\bmedia\s+hora\b`,
    String.raw`\bhora\s+y\s+media\b`,
    String.raw`\bhalf\s+an?\s+hour\b`,
    String.raw`\bmas\s+tarde\b`,
  ].join("|"),
);
// "por la tarde", "in the morning": el asesor dio una franja, el modelo eligió la hora.
const PERIOD_RE = new RegExp(
  [
    String.raw`\b(?:por|en|de|a)\s+la\s+(?:manana|tarde|noche|madrugada)\b`,
    String.raw`\besta\s+(?:tarde|noche)\b`,
    String.raw`\btemprano\b`,
    String.raw`\b(?:in\s+the\s+(?:morning|afternoon|evening)|tonight|this\s+(?:morning|afternoon|evening)|early|at\s+night)\b`,
  ].join("|"),
);

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function addTime(out: Set<string>, h: number, m: number, marker?: string): void {
  if (h < 0 || h > 24 || m < 0 || m > 59) return;
  const mk = marker?.replace(/\./g, "");
  if (mk === "pm") out.add(`${pad(h < 12 ? h + 12 : h)}:${pad(m)}`);
  else if (mk === "am") out.add(`${pad(h === 12 ? 0 : h)}:${pad(m)}`);
  else if (h >= 1 && h <= 11) {
    out.add(`${pad(h)}:${pad(m)}`);
    out.add(`${pad(h + 12)}:${pad(m)}`);
  } else if (h === 12) {
    out.add(`12:${pad(m)}`);
    out.add(`00:${pad(m)}`);
  } else out.add(`${pad(h % 24)}:${pad(m)}`);
}

/** Todas las horas HH:MM que el texto menciona de alguna forma (am/pm ambiguo → ambas). */
export function timesMentioned(text: string): Set<string> {
  const t = norm(text);
  const out = new Set<string>();
  for (const m of t.matchAll(HM_RE)) addTime(out, Number(m[1]), Number(m[2]), m[3]);
  for (const m of t.matchAll(MARKED_RE)) addTime(out, Number(m[1]), 0, m[2]);
  for (const m of t.matchAll(PREP_RE)) {
    let h = /^\d+$/.test(m[1]) ? Number(m[1]) : NUM_WORDS[m[1]];
    let min = m[2] ? Number(m[2]) : 0;
    if (m[3]) min = m[3] === "media" ? 30 : m[3] === "cuarto" ? 15 : Number(m[3]);
    if (m[4]) {
      h -= 1;
      min = 60 - (m[4] === "cuarto" ? 15 : Number(m[4]));
    }
    addTime(out, h, min, m[5]);
  }
  if (NOON_RE.test(t)) out.add("12:00");
  if (MIDNIGHT_RE.test(t)) out.add("00:00");
  return out;
}

/** "HH:MM" de un ISO con hora local; null si es solo fecha. */
function timeOfDueDate(dueDate: unknown): string | null {
  const m = typeof dueDate === "string" ? dueDate.match(/T(\d{2}):(\d{2})/) : null;
  return m ? `${m[1]}:${m[2]}` : null;
}

function remindersSeenThisTurn(turn: GuardTurnState): Record<string, unknown>[] {
  return turn.toolCalls.flatMap((t) => (REMINDER_LOOKUPS.has(t.name) ? reminderItems(t.result) ?? [] : []));
}

export const inventedTime: ToolGuard = {
  name: "invented_time",
  check(call, turn) {
    if (call.name !== "create_reminder" && call.name !== "create_reminder_for_client" && call.name !== "update_reminder") {
      return ALLOW;
    }
    const time = timeOfDueDate(call.args.due_date);
    if (!time || time === "00:00") return ALLOW; // sin hora: solo el día

    const advisorNorm = norm(turn.sessionAdvisorWords);
    if (RELATIVE_RE.test(advisorNorm) || PERIOD_RE.test(advisorNorm)) return ALLOW;
    if (timesMentioned(`${turn.sessionAdvisorWords}\n${turn.priorAssistantText}`).has(time)) return ALLOW;

    // La hora de un recordatorio que ya existe (mover el día sin tocar la hora).
    const seen = remindersSeenThisTurn(turn);
    if (call.name === "update_reminder") {
      const original = seen.filter((r) => r.id === call.args.reminder_id);
      if (original.length === 0) return ALLOW; // no se sabe cuál era la hora: ante la duda, pasa
      if (original.some((r) => timeOfDueDate(r.dueDate) === time)) return ALLOW;
    } else if (seen.some((r) => timeOfDueDate(r.dueDate) === time)) return ALLOW;

    return {
      verdict: "block",
      reason: "time_not_stated",
      messageForModel: `Not executed: the time ${time} in due_date does not appear in anything the advisor said. ` +
        "Do not make up a time. Use the time the advisor stated; if they gave only a day, use that day with no " +
        "time (00:00 local), or ask them what time they want.",
    };
  },
};

// ─── Runner ────────────────────────────────────────────────────────────────

export const DEFAULT_TOOL_GUARDS: readonly ToolGuard[] = [
  rescheduleWithoutAppointment,
  createBeforeDisambiguation,
  inventedTime,
];

export interface BlockedCall {
  guard: string;
  reason: string;
  messageForModel: string;
}

export class ToolGuards {
  constructor(
    readonly mode: ToolGuardsMode,
    private guards: readonly ToolGuard[] = DEFAULT_TOOL_GUARDS,
  ) {}

  /**
   * Devuelve la guarda que bloquea la llamada, o null si debe ejecutarse. En
   * "log" registra cada bloqueo que habría hecho pero devuelve null. Una guarda
   * que truena se ignora: un bug de la guarda no debe tumbar una herramienta.
   */
  check(call: AiFunctionCall, turn: GuardTurnState): BlockedCall | null {
    if (this.mode === "off") return null;
    let blocked: BlockedCall | null = null;
    for (const guard of this.guards) {
      let v: GuardVerdict;
      try {
        v = guard.check(call, turn);
      } catch {
        console.warn(`[GUARD] error guard=${guard.name} tool=${call.name}`);
        continue;
      }
      if (v.verdict !== "block") continue;
      const verb = this.mode === "enforce" ? "blocked" : "would_block";
      console.warn(`[GUARD] ${verb} guard=${guard.name} tool=${call.name} reason=${v.reason}`);
      if (this.mode === "enforce") {
        blocked = { guard: guard.name, reason: v.reason, messageForModel: v.messageForModel };
        break;
      }
    }
    return blocked;
  }
}
