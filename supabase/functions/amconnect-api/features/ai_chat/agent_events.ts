// Eventos que emite el AgentLoop durante un turno. Hoy los junta
// AiChatService para responder JSON; el endpoint SSE (Fase 2, paso 4) los
// traducirá 1:1 a `event: status|tool|delta|done`. No saben de HTTP.
//
// En pantalla se muestra `label`, NUNCA `name`: el nombre técnico de la
// herramienta es para logs y depuración.
import type { UsageTokens } from "./ai_session.service.ts";
import type { RagAttachmentCollector } from "./rag_attachments.ts";

/** Por qué se hizo la pasada de cierre sin herramientas. */
export type ExhaustedReason = "max_loops" | "empty_response";

/** Resultado del turno: lo mismo que viaja en el evento `done`. */
export interface AgentLoopResult {
  /** Texto final para el asesor, sin marcadores de cita (incluye el texto de respaldo). */
  text: string;
  usage: UsageTokens;
  citedNoteIds: Set<string>;
  ragAttachments: RagAttachmentCollector;
  skillMetadata: Record<string, unknown> | undefined;
  lastInteractionId: string | undefined;
  /** Llamadas al modelo hechas en el turno (para decidir devoluciones de cuota). */
  modelCalls: number;
}

export type AgentEvent =
  | { type: "model_call_started"; call: number; forceTextOnly: boolean }
  | { type: "tool_started"; name: string; label: string }
  | { type: "tool_finished"; name: string; label: string; ok: boolean }
  /**
   * Texto completo del turno; el SSE lo manda como un solo `delta`. Es a
   * propósito, no un pendiente (decisión 2026-11-23): sin streaming palabra por
   * palabra, porque retractar texto ya mostrado cuando Gemini cambia a una
   * herramienta complica más de lo que valen ~2 s.
   */
  | { type: "text"; text: string }
  | { type: "exhausted"; reason: ExhaustedReason; maxLoops: number }
  /** Se detuvo antes de la siguiente llamada al modelo o herramienta (§7.3). */
  | { type: "cancelled"; modelCalls: number }
  | ({ type: "done" } & AgentLoopResult);

export type AgentEventListener = (event: AgentEvent) => void | Promise<void>;

type LabelLanguage = "es" | "en";

// Etiquetas humanas por herramienta. Mínimo a propósito: lo que no esté aquí
// cae en la genérica. Agrupadas por lo que el asesor entiende, no por skill.
const LABELS: Record<string, Record<LabelLanguage, string>> = {
  search_contact: { es: "Buscando contacto", en: "Looking up contact" },
  get_contact: { es: "Buscando contacto", en: "Looking up contact" },
  create_contact: { es: "Guardando contacto", en: "Saving contact" },
  update_contact: { es: "Guardando contacto", en: "Saving contact" },
  search_policies: { es: "Revisando pólizas", en: "Checking policies" },
  find_policy_by_client: { es: "Revisando pólizas", en: "Checking policies" },
  get_upcoming_reminders: { es: "Revisando tu agenda", en: "Checking your schedule" },
  search_reminders: { es: "Revisando tu agenda", en: "Checking your schedule" },
  create_reminder: { es: "Agendando recordatorio", en: "Scheduling reminder" },
  create_reminder_for_client: { es: "Agendando recordatorio", en: "Scheduling reminder" },
  create_commitment: { es: "Guardando compromiso", en: "Saving commitment" },
  search_knowledge: { es: "Buscando en tus notas", en: "Searching your notes" },
  recall: { es: "Buscando en tus notas", en: "Searching your notes" },
};

const GENERIC_LABEL: Record<LabelLanguage, string> = { es: "Trabajando…", en: "Working…" };

/**
 * Etiqueta para mostrarle al asesor mientras corre una herramienta.
 * `replyLanguage` es el nombre en inglés que usa el turno ("Spanish",
 * "English"); cualquier otro valor cae en español, el idioma por defecto.
 */
export function toolLabel(name: string, replyLanguage: string): string {
  const lang: LabelLanguage = replyLanguage === "English" ? "en" : "es";
  return LABELS[name]?.[lang] ?? GENERIC_LABEL[lang];
}
