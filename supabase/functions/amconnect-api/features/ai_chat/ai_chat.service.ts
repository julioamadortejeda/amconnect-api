import { AiMessage, AiRole, IAiProvider, type TokenUsage } from "../../core/ai_provider.interface.ts";
import { AiSessionService, type UsageTokens } from "./ai_session.service.ts";
import { AiProviderError, AppError } from "../../shared/errors.ts";
import { executeSkill } from "./skills/skill_executor.ts";
import { SkillContext, SkillServices } from "./skills/skill.core.ts";
import { buildLocalDateTime, DEFAULT_TIMEZONE } from "../../shared/datetime.ts";
import { PromptService } from "../../modules/prompt/prompt.service.ts";
import type { PolicyChange } from "../document_processing/policy_diff.ts";
import { AiChatContext } from "./ai.dto.ts";
import { buildContextPrefix, collectAdvisorWords } from "./chat_turn.ts";
import { extractCitations, RagAttachmentCollector } from "./rag_attachments.ts";
import { TOOL_SELECTION_MODE, type ToolSelectionMode } from "../../shared/assistant.config.ts";
import { type ConversationStore, SessionConversationStore } from "./conversation_store.ts";
import { DomainToolSelector, type ToolSelection, type ToolSelector } from "./tool_selector.ts";

const MAX_LOOPS = 6;

export interface ChatResponse {
  text: string;
  sessionId: string;
  usage: UsageTokens;
  sessionUsage?: UsageTokens;
  metadata?: Record<string, unknown>;
}

/** Resultado del bucle de function calling de un turno. */
interface LoopResult {
  finalText: string;
  citedNoteIds: Set<string>;
  skillMetadata: Record<string, unknown> | undefined;
  loopUsage: UsageTokens;
  lastInteractionId: string | undefined;
  ragAttachments: RagAttachmentCollector;
}

function emptyUsage(): UsageTokens {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0, cachedTokens: 0, thoughtsTokens: 0 };
}

/** Suma `usage` (si hay) a `target` y lo devuelve. */
function addUsage(target: UsageTokens, usage?: TokenUsage): UsageTokens {
  if (!usage) return target;
  target.promptTokens += usage.promptTokens;
  target.completionTokens += usage.completionTokens;
  target.totalTokens += usage.totalTokens;
  target.cachedTokens = (target.cachedTokens ?? 0) + (usage.cachedTokens ?? 0);
  target.thoughtsTokens = (target.thoughtsTokens ?? 0) + (usage.thoughtsTokens ?? 0);
  return target;
}

export class AiChatService {
  private store: ConversationStore;
  private toolSelector: ToolSelector;

  constructor(
    private aiProvider: IAiProvider,
    private skillContext: SkillServices,
    private aiSessionService: AiSessionService,
    private promptService: PromptService,
    // Inyectable para pruebas; en producción es el valor de shared/assistant.config.ts.
    toolSelectionMode: ToolSelectionMode = TOOL_SELECTION_MODE,
    // Inyectables para pruebas; por defecto se construyen sobre el provider y la sesión.
    store?: ConversationStore,
    toolSelector?: ToolSelector,
  ) {
    this.store = store ?? new SessionConversationStore(aiSessionService);
    this.toolSelector = toolSelector ?? new DomainToolSelector(aiProvider, toolSelectionMode);
  }

  async cancelSession(sessionId: string): Promise<{ cancelledTasks: number }> {
    return await this.aiSessionService.cancelSession(sessionId);
  }

  async processMessage(
    message: string,
    agentId: string,
    sessionId?: string | null,
    timezone?: string,
    context?: AiChatContext | null,
    newSessionType: "chat" = "chat",
    advisorLocale?: string,
  ): Promise<ChatResponse> {
    // Sesión existente: candado de turno ANTES de cualquier gasto (clasificador,
    // modelo). Dos mensajes simultáneos hacían leer-modificar-escribir del
    // historial y el último pisaba al primero (bug #6); el segundo recibe 409.
    // Sesión nueva: sin candado, nadie conoce su id hasta que este turno
    // responde, así que no puede haber un segundo mensaje concurrente.
    if (sessionId) await this.store.acquireTurnLock(sessionId);
    try {
      return await this.runTurn(message, agentId, sessionId, timezone, context, newSessionType, advisorLocale);
    } finally {
      if (sessionId) await this.store.releaseTurnLock(sessionId);
    }
  }

  private async runTurn(
    message: string,
    agentId: string,
    sessionId: string | null | undefined,
    timezone: string | undefined,
    context: AiChatContext | null | undefined,
    newSessionType: "chat",
    advisorLocale: string | undefined,
  ): Promise<ChatResponse> {
    const session = await this.openSession(message, agentId, sessionId, newSessionType);
    const { history } = session;
    const pendingTasks = await this.store.getPendingTasks(session.sessionId);

    const selection = await this.toolSelector.select({
      message,
      context,
      pendingTasks,
      sessionType: session.type,
      history,
      advisorLocale,
    });

    const isPolicyIngestion = session.type === "policy_ingestion";
    // System instruction ESTÁTICO: nada se sustituye aquí. Lo que cambia por
    // request —fecha, idioma, pending tasks, pantalla activa— va en el mensaje
    // del usuario (abajo), así el implicit caching de Gemini lo comparte entre
    // todos los asesores (medido el 2026-09-07: 12,078 de 13,270 tokens cacheados).
    const dbPromptCode = isPolicyIngestion ? "policy_ingestion_system" : "ai_chat_system";
    const systemInstruction = await this.promptService.getPrompt(dbPromptCode, {});

    // Fecha y hora local del asesor — implementación compartida con voz
    const { localIso, offsetStr } = buildLocalDateTime(timezone || DEFAULT_TIMEZONE);
    const contextPrefix = buildContextPrefix({
      localIso,
      offsetStr,
      replyLanguage: selection.replyLanguage,
      pendingTasks,
      context,
    });
    history.push({ role: AiRole.USER, parts: [{ text: contextPrefix + message }] });

    const ctx: SkillContext = {
      agentId,
      sessionId: session.sessionId,
      aiSessionService: this.aiSessionService,
      ...this.skillContext,
      timezone: timezone || "America/Mexico_City",
      timezoneOffset: offsetStr || "-06:00",
      advisorWords: collectAdvisorWords(history),
    };

    const loop = await this.guardProviderErrors(session.sessionId, () =>
      this.runAgentLoop({
        input: contextPrefix + message,
        selection,
        systemInstruction,
        history,
        lastInteractionId: session.lastInteractionId,
        ctx,
      }));

    const finalText = loop.finalText || this.exhaustedFallback(history);
    return await this.finishTurn({
      message,
      agentId,
      sessionId: session.sessionId,
      history,
      loop,
      finalText,
      classifyUsage: selection.classifyUsage,
      context,
    });
  }

  /** Carga la sesión existente (404 si no es tuya) o crea una nueva. */
  private async openSession(
    message: string,
    agentId: string,
    sessionId: string | null | undefined,
    newSessionType: "chat",
  ): Promise<{ sessionId: string; history: AiMessage[]; type: string; lastInteractionId: string | undefined }> {
    if (sessionId) {
      const loaded = await this.store.loadSession(sessionId);
      return {
        sessionId,
        history: loaded.history,
        type: loaded.type ?? newSessionType,
        lastInteractionId: loaded.lastInteractionId,
      };
    }
    const created = await this.store.createSession(agentId, {
      triggerMessage: message,
      sessionType: newSessionType,
      modelName: this.aiProvider.model,
    });
    return { sessionId: created, history: [], type: newSessionType, lastInteractionId: undefined };
  }

  /**
   * Falla del proveedor (AiProviderError) o error crudo no controlado (red,
   * timeout): el asesor no recibió respuesta, la sesión no es facturable.
   * AiError y demás AppError (lógica nuestra) conservan su comportamiento.
   */
  private async guardProviderErrors<T>(sessionId: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      if (e instanceof AiProviderError || !(e instanceof AppError)) {
        await this.store.markProviderError(sessionId, e instanceof Error ? e.message : String(e));
      }
      throw e;
    }
  }

  // Ultimo recurso: ni siquiera el turno de cierre produjo texto.
  //
  // Sigue sin ser un 502. Para cuando llegamos aqui el asistente pudo haber
  // escrito de verdad —un compromiso, un recordatorio, una nota— y un error
  // le diria al asesor lo contrario. Se contesta con la verdad: no se pudo
  // resumir, revisa. Sin inventar que se hizo algo ni jurar que no se hizo
  // nada, porque desde aqui no se sabe cual de las dos.
  private exhaustedFallback(history: AiMessage[]): string {
    console.warn("[AiChat] El turno de cierre tampoco devolvió texto");
    const text = "Me quedé sin poder resumirte lo que hice. Puede que sí haya " +
      "quedado registrado — revisa tu agenda o vuelve a pedírmelo para confirmar.";
    history.push({ role: AiRole.MODEL, parts: [{ text }] });
    return text;
  }

  /** Bucle de function calling + turno de cierre si se agotaron las vueltas. */
  private async runAgentLoop(p: {
    input: string;
    selection: ToolSelection;
    systemInstruction: string;
    history: AiMessage[];
    lastInteractionId: string | undefined;
    ctx: SkillContext;
  }): Promise<LoopResult> {
    const { selection, systemInstruction, history, ctx } = p;
    const tools = selection.tools;
    const offeredTools = selection.offeredNames;
    let lastInteractionId = p.lastInteractionId;
    const loopUsage = emptyUsage();

    let finalText = "";
    let loops = 0;
    let forceNextTurnToGenerateText = false;
    let skillMetadata: Record<string, unknown> | undefined;
    let nextInteractionInput: string | Record<string, unknown>[] = p.input;

    // Adjuntos recolectados de los hits de RAG durante el bucle.
    const ragAttachments = new RagAttachmentCollector();
    // Notas citadas explícitamente por el modelo en su respuesta final (ver CITE_MARKER_RE).
    let citedNoteIds = new Set<string>();

    while (loops < MAX_LOOPS) {
      loops++;
      // Siempre mandamos `tools` completo (aunque forceNextTurnToGenerateText esté activo)
      // para no cambiar el prefix system_instruction+tools entre turnos y no perder el
      // implicit caching de Gemini — el bloqueo de function calls se hace vía forceTextOnly.
      const result = await this.aiProvider.processInteraction(
        nextInteractionInput,
        tools,
        systemInstruction,
        lastInteractionId,
        history,
        forceNextTurnToGenerateText,
      );

      if (result.interactionId) {
        lastInteractionId = result.interactionId;
      }

      addUsage(loopUsage, result.usage);

      if (result.text && !result.functionCalls?.length) {
        const { displayText, citedNoteIds: cited } = extractCitations(result.text);
        finalText = displayText;
        citedNoteIds = cited;
        history.push({ role: AiRole.MODEL, parts: [{ text: displayText }] });
        break;
      }

      // Respuesta vacia: ni texto ni herramientas. Se sale del bucle en vez de
      // tronar, por lo mismo que el agotamiento de turnos — abajo hay un intento
      // de cierre y, si tampoco sale, un mensaje honesto. Un 502 aqui le diria
      // al asesor que no paso nada cuando puede que ya se haya escrito.
      if (!result.functionCalls?.length) {
        console.warn("[AiChat] El modelo no devolvió texto ni function calls");
        break;
      }

      // Ejecutar function calls
      const functionResults = [];
      const functionResponseSteps: Record<string, unknown>[] = [];
      history.push({ role: AiRole.MODEL, parts: result.rawModelParts as never[] });

      for (const call of result.functionCalls) {
        // Recuperar el id del step original de la llamada para mapearlo al response de la Interactions API
        const originalStep = result.rawModelParts?.find(
          // deno-lint-ignore no-explicit-any
          (p: any) => p.functionCall && p.functionCall.name === call.name,
        );
        // deno-lint-ignore no-explicit-any
        const callId = (originalStep as any)?.functionCall?.id || `call_${Math.random().toString(36).substring(7)}`;

        const execution = await executeSkill(call.name, call.args, ctx, offeredTools);
        if (execution.metadata) skillMetadata = execution.metadata;
        const response = execution.response;

        // Si la base de conocimiento o notas de contacto/póliza devuelven vacío,
        // forzamos que en el siguiente turno genere texto directo.
        if (ragAttachments.harvest(call.name, response).emptyRagSearch) {
          forceNextTurnToGenerateText = true;
        }

        functionResults.push({
          functionResponse: { name: call.name, response: { result: response } },
        });

        functionResponseSteps.push({
          type: "function_result",
          call_id: callId,
          name: call.name,
          result: [
            {
              type: "text",
              text: typeof response === "string" ? response : JSON.stringify(response),
            },
          ],
        });
      }

      history.push({ role: AiRole.USER, parts: functionResults as never[] });

      // Configurar el input para el siguiente turno de la Interactions API como el listado de steps de respuesta
      nextInteractionInput = functionResponseSteps;
    }

    // Se acabaron los turnos y el modelo sigue pidiendo herramientas.
    //
    // Antes esto tronaba con AiError y el asesor veía un error genérico —
    // después de que el asistente YA hizo el trabajo: creó el compromiso, buscó
    // al cliente, lo que fuera. Todo eso quedó escrito en la base y él se quedó
    // creyendo que nada pasó, porque lo único que vio fue el error.
    //
    // Un turno más con las function calls bloqueadas: el modelo tiene el
    // historial completo con lo que ya ejecutó, así que puede contarlo. Se
    // mandan `tools` igual —sin cambiar el prefijo no se pierde el caching— y
    // el bloqueo va por forceTextOnly, el mismo camino que ya usa el RAG vacío.
    if (!finalText) {
      console.warn(`[AiChat] MAX_LOOPS (${MAX_LOOPS}) agotado — turno final sin herramientas`);

      const cierre = await this.aiProvider.processInteraction(
        nextInteractionInput,
        tools,
        systemInstruction,
        lastInteractionId,
        history,
        true,
      );

      addUsage(loopUsage, cierre.usage);

      if (cierre.text) {
        const { displayText, citedNoteIds: cited } = extractCitations(cierre.text);
        finalText = displayText;
        citedNoteIds = cited;
        history.push({ role: AiRole.MODEL, parts: [{ text: displayText }] });
      }
    }

    return { finalText, citedNoteIds, skillMetadata, loopUsage, lastInteractionId, ragAttachments };
  }

  /** Guarda el turno (historial, mensajes, tokens) y arma la respuesta. */
  private async finishTurn(p: {
    message: string;
    agentId: string;
    sessionId: string;
    history: AiMessage[];
    loop: LoopResult;
    finalText: string;
    classifyUsage: TokenUsage | undefined;
    context: AiChatContext | null | undefined;
  }): Promise<ChatResponse> {
    const { loop } = p;
    const classifyTokens = addUsage(emptyUsage(), p.classifyUsage);
    const totalUsage = addUsage({ ...classifyTokens }, loop.loopUsage);

    const sessionUsage = await this.store.saveTurn({
      agentId: p.agentId,
      sessionId: p.sessionId,
      history: p.history,
      messages: [
        { role: "user", content: p.message, promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        { role: "classify", content: null, ...classifyTokens },
        { role: "model", content: p.finalText, ...loop.loopUsage, interactionId: loop.lastInteractionId },
      ],
      totalUsage,
      lastInteractionId: loop.lastInteractionId,
    });

    // attachment_list se alimenta de dos fuentes complementarias: los hits de
    // RAG con documento adjunto (búsqueda vectorial) y las notas del contexto de
    // pantalla. Solo se emite si ninguna skill ya produjo su propio metadata.
    const metadata = loop.skillMetadata ?? loop.ragAttachments.buildAttachmentList(loop.citedNoteIds, p.context);

    return { text: p.finalText, sessionId: p.sessionId, usage: totalUsage, sessionUsage, metadata };
  }

  async startPolicySession(
    sessionId: string,
    agentId: string,
    extraction: unknown,
    _documentMetadataId: string,
  ): Promise<ChatResponse> {
    const extractionSummary = JSON.stringify(extraction, null, 2);
    const initialMessage = `[SYSTEM_INGESTION] El sistema extrajo la siguiente información de la póliza:\n\`\`\`json\n${extractionSummary}\n\`\`\`\nPor favor presenta un resumen al asesor y solicita confirmación para crear la póliza.`;

    return await this.processMessage(initialMessage, agentId, sessionId);
  }

  async startPolicyUpdateSession(
    sessionId: string,
    agentId: string,
    extraction: unknown,
    existingPolicyId: string,
    diff: PolicyChange[],
  ): Promise<ChatResponse> {
    const policyNumber = (extraction as { policyNumber?: string }).policyNumber ?? 'N/A';
    const diffLines = diff.length > 0
      ? diff.map(c => `- ${c.label}: "${c.oldValue ?? '—'}" → "${c.newValue}"`).join('\n')
      : '(no field differences detected)';

    const initialMessage = [
      `[SYSTEM_INGESTION] Policy number "${policyNumber}" already exists in the advisor's portfolio (ID: ${existingPolicyId}).`,
      '',
      'Differences detected vs. existing data:',
      diffLines,
      '',
      'Inform the advisor about the duplicate and ask whether they want to UPDATE the existing policy with the new data, or DISCARD the new document.',
    ].join('\n');

    return await this.processMessage(initialMessage, agentId, sessionId);
  }
}
