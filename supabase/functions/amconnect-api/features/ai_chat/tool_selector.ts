// Qué herramientas viajan en un turno del chat de texto, su lista blanca
// (bug #7) y el idioma de respuesta. Encapsula TOOL_SELECTION_MODE, el
// clasificador, ALWAYS_ACTIVE y la exclusión de resolve_pending_task.
import type { AiMessage, IAiProvider, TokenUsage } from "../../core/ai_provider.interface.ts";
import { buildToolDeclarations, offeredToolNames } from "../../shared/tool_declarations.ts";
import { languageName } from "../../shared/locale.ts";
import type { ToolSelectionMode } from "../../shared/assistant.config.ts";
import type { AiChatContext } from "./ai.dto.ts";
import { AVAILABLE_DOMAINS, lastReplyLanguage, POLICY_INGESTION_DOMAINS, resolveChatDomains } from "./chat_turn.ts";
import { detectReplyLanguage, type ReplyLanguage } from "./reply_language.ts";

export interface ToolSelectionInput {
  message: string;
  context?: AiChatContext | null;
  pendingTasks: ReadonlyArray<unknown>;
  sessionType: string;
  /** Historial ANTES de agregar el mensaje de este turno. */
  history: readonly AiMessage[];
  advisorLocale?: string;
}

export interface ToolSelection {
  tools: Array<{ functionDeclarations: ReturnType<typeof buildToolDeclarations> }>;
  /** Lista blanca de nombres ofrecidos este turno (bug #7). */
  offeredNames: ReadonlySet<string>;
  activeDomains: string[];
  replyLanguage: string;
  langSource: string;
  classifyUsage?: TokenUsage;
  /** El clasificador detectó "mover algo que ya existe" (siempre false en modo "all"). */
  moveExisting: boolean;
}

/**
 * Herramientas que CREAN un recordatorio/cita. Con `moveExisting` no se ofrecen:
 * `reschedule_reminder` no crea, y si no hay nada que mover el modelo debe
 * preguntar, no inventar una hora (2026-11-23: "Patricia me dijo que hoy no me
 * puede ver, que la reagende mañana" sin cita → create_reminder_for_client a
 * las 10:00 inventadas). También `create_commitment`: mover nunca crea nada, y
 * si se ofrece el modelo puede usarlo de salida cuando no encontró la cita.
 */
export const REMINDER_CREATION_TOOLS: readonly string[] = ["create_reminder", "create_reminder_for_client", "create_commitment"];

export interface ToolSelector {
  select(input: ToolSelectionInput): Promise<ToolSelection>;
}

interface DomainChoice {
  activeDomains: string[];
  classifyUsage?: TokenUsage;
  detectedLanguage?: string;
  moveExisting: boolean;
}

export class DomainToolSelector implements ToolSelector {
  constructor(
    private aiProvider: IAiProvider,
    private mode: ToolSelectionMode,
  ) {}

  async select(input: ToolSelectionInput): Promise<ToolSelection> {
    const isPolicyIngestion = input.sessionType === "policy_ingestion";
    const useAllTools = !isPolicyIngestion && this.mode === "all";

    const choice = await this.chooseDomains(input, isPolicyIngestion, useAllTools);
    const tools = this.buildTools(choice.activeDomains, input.pendingTasks.length, choice.moveExisting);
    const language = this.resolveLanguage(input, choice.detectedLanguage, useAllTools);

    if (!isPolicyIngestion) {
      console.warn(
        `[TOOLS] mode=${this.mode} count=${tools.tools[0].functionDeclarations.length} lang=${language.replyLanguage} langSource=${language.langSource} moveExisting=${choice.moveExisting} removed=${tools.removedCount}`,
      );
    }
    return {
      tools: tools.tools,
      offeredNames: offeredToolNames(tools.tools[0].functionDeclarations),
      moveExisting: choice.moveExisting,
      activeDomains: choice.activeDomains,
      classifyUsage: choice.classifyUsage,
      ...language,
    };
  }

  private async chooseDomains(input: ToolSelectionInput, isPolicyIngestion: boolean, useAllTools: boolean): Promise<DomainChoice> {
    if (isPolicyIngestion) return { activeDomains: POLICY_INGESTION_DOMAINS, moveExisting: false };
    // Todas las herramientas de chat, en el orden del registro de skills
    // (estable entre turnos y asesores). Sin clasificador.
    // Sin clasificador no hay `moveExisting`: en modo "all" el comportamiento no
    // cambia (se ofrecen las herramientas de crear aunque se pida mover algo).
    if (useAllTools) return { activeDomains: AVAILABLE_DOMAINS, moveExisting: false };
    const { domains, usage, language, moveExisting } = await this.aiProvider.classifyMessage(input.message, AVAILABLE_DOMAINS);
    return {
      activeDomains: resolveChatDomains(domains, input.context),
      classifyUsage: usage,
      detectedLanguage: language,
      moveExisting: moveExisting === true,
    };
  }

  // Sin tareas pendientes, `resolve_pending_task` ni siquiera se ofrece.
  //
  // No es optimización: es quitarle al modelo una salida falsa. Cuando hay
  // que desambiguar un cliente, en el turno de la aclaración ("el segundo")
  // el modelo llama a resolve_pending_task —con un id inventado, porque no
  // guardó ninguna— la da por buena y le confirma al asesor un compromiso
  // que nunca creó. Pedírselo por prompt no bastó: se probó dos veces el
  // 2026-08-28 y en la segunda cambió una mentira por otra ("lo registré en
  // las notas", sin llamar a nada). Si la herramienta no existe en el turno,
  // no hay a dónde escaparse: tiene que llamar a la que de verdad escribe.
  //
  // Con `moveExisting` también se quitan las herramientas que crean
  // recordatorios (ver REMINDER_CREATION_TOOLS). La lista blanca se deriva de
  // estas mismas declaraciones, así que queda consistente sola.
  private buildTools(
    activeDomains: string[],
    pendingCount: number,
    moveExisting: boolean,
  ): { tools: ToolSelection["tools"]; removedCount: number } {
    const exclude = pendingCount === 0 ? ["resolve_pending_task"] : [];
    const all = buildToolDeclarations(activeDomains, { exclude });
    const functionDeclarations = moveExisting
      ? all.filter((d) => !REMINDER_CREATION_TOOLS.includes(d.name ?? ""))
      : all;
    return { tools: [{ functionDeclarations }], removedCount: all.length - functionDeclarations.length };
  }

  // El idioma de respuesta es un DATO del turno, no una regla del prompt
  // (medido el 2026-09-14: pedirle al modelo que lo detectara fallaba 13/24).
  // Fuentes, en orden:
  //   1. Lo que detectó el clasificador para ESTE mensaje.
  //   2. El último idioma usado en la conversación (vive en el [CONTEXT] que
  //      se guarda con cada turno del asesor; salva "ok", "el segundo", etc.).
  //   3. El idioma que el asesor configuró en la app, para el primer turno.
  // El modo "all" no tiene clasificador: detecta localmente, y su fallback
  // (2 o 3) depende del historial.
  private resolveLanguage(
    input: ToolSelectionInput,
    detectedLanguage: string | undefined,
    useAllTools: boolean,
  ): { replyLanguage: string; langSource: string } {
    const fallbackLanguage = lastReplyLanguage([...input.history]) ?? languageName(input.advisorLocale);
    if (useAllTools) {
      const d = detectReplyLanguage(
        input.message,
        fallbackLanguage === "English" ? "English" : "Spanish" as ReplyLanguage,
      );
      return { replyLanguage: d.language, langSource: d.source };
    }
    return {
      replyLanguage: detectedLanguage ?? fallbackLanguage,
      langSource: detectedLanguage ? "detected" : "fallback",
    };
  }
}
