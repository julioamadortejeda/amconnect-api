// Guardas deterministas sobre las herramientas de escritura (Fase 2, paso 3).
//
// Se revisan en AgentLoop justo antes de ejecutar una herramienta. Cada guarda
// es una función PURA y ESTRUCTURAL: decide solo con las herramientas que ya
// se ejecutaron y sus resultados, NUNCA leyendo lo que el asesor escribió (ni
// listas de palabras ni expresiones regulares sobre texto). Ante la duda
// siempre "allow": un falso positivo le estorba al asesor, un falso negativo
// es lo que ya pasaba antes.
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
  // Las guardas actuales no leen lo que escribió el asesor. Estos campos los
  // sigue llenando AgentLoop y se conservan solo para no tocarlo; ninguna guarda
  // debe usarlos para decidir.
  /** @deprecated No usar en guardas. */
  advisorWords?: string;
  /** @deprecated No usar en guardas. */
  sessionAdvisorWords?: string;
  /** @deprecated No usar en guardas. */
  priorAssistantText?: string;
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

// ─── Utilidades de resultados ──────────────────────────────────────────────

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

/** Contactos de un resultado de search_contact; null si no es un resultado usable. */
function contactMatches(result: unknown): { id: string }[] | null {
  const o = asRecord(parseResult(result));
  if (!o || hasError(o) || !Array.isArray(o.contacts)) return null;
  return o.contacts.map(asRecord)
    .filter((c): c is Record<string, unknown> => !!c)
    .map((c) => ({ id: String(c.id ?? "") }));
}

// ─── Crear antes de desambiguar ──────────────────────────────────

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

export const createBeforeDisambiguation: ToolGuard = {
  name: "create_before_disambiguation",
  check(call, turn) {
    if (!createsClientLinkedRecord(call)) return ALLOW;

    // Lo último que pasó con la identidad del cliente en este turno; de paso,
    // los contactos que una búsqueda de resultado único ya resolvió.
    let ambiguous = false;
    const resolvedIds = new Set<string>();
    for (const t of turn.toolCalls) {
      if (t.name === "resolve_pending_task") {
        if (!hasError(parseResult(t.result))) ambiguous = false;
      } else if (t.name === "search_contact") {
        const m = contactMatches(t.result);
        if (m === null) continue; // búsqueda fallida: no dice nada
        ambiguous = m.length > 1;
        if (m.length === 1) resolvedIds.add(m[0].id);
      }
    }
    if (!ambiguous) return ALLOW;
    // La llamada ya trae el id de un contacto que una búsqueda de 1 resultado resolvió antes.
    const contactId = str(call.args.contact_id);
    if (contactId && resolvedIds.has(contactId)) return ALLOW;

    return {
      verdict: "block",
      reason: "ambiguous_contact",
      messageForModel: "Not executed: the last client search in this turn returned several contacts and none " +
        "has been chosen yet. Do not pick one yourself. List the matching clients and ask the advisor which " +
        "one they mean; create the record only after they answer.",
    };
  },
};

// ─── Runner ────────────────────────────────────────────────────────────────

export const DEFAULT_TOOL_GUARDS: readonly ToolGuard[] = [
  createBeforeDisambiguation,
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
