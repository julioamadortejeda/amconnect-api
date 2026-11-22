import { AiMessage, AiRole, IAiProvider, type TokenUsage } from "../../core/ai_provider.interface.ts";
import { AiSessionService, type UsageTokens } from "./ai_session.service.ts";
import { AiProviderError, AppError } from "../../shared/errors.ts";
import { SkillContext, SkillServices } from "./skills/skill.core.ts";
import { buildLocalDateTime, DEFAULT_TIMEZONE } from "../../shared/datetime.ts";
import { PromptService } from "../../modules/prompt/prompt.service.ts";
import type { PolicyChange } from "../document_processing/policy_diff.ts";
import { AiChatContext } from "./ai.dto.ts";
import { buildContextPrefix, collectAdvisorWords } from "./chat_turn.ts";
import { TOOL_SELECTION_MODE, type ToolSelectionMode } from "../../shared/assistant.config.ts";
import { type ConversationStore, SessionConversationStore } from "./conversation_store.ts";
import { DomainToolSelector, type ToolSelector } from "./tool_selector.ts";
import { AgentLoop } from "./agent_loop.ts";
import type { AgentLoopResult } from "./agent_events.ts";
import { addUsage, emptyUsage } from "./token_usage.ts";

export interface ChatResponse {
  text: string;
  sessionId: string;
  usage: UsageTokens;
  sessionUsage?: UsageTokens;
  metadata?: Record<string, unknown>;
}

export class AiChatService {
  private store: ConversationStore;
  private toolSelector: ToolSelector;
  private agentLoop: AgentLoop;

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
    agentLoop?: AgentLoop,
  ) {
    this.store = store ?? new SessionConversationStore(aiSessionService);
    this.toolSelector = toolSelector ?? new DomainToolSelector(aiProvider, toolSelectionMode);
    this.agentLoop = agentLoop ?? new AgentLoop(aiProvider);
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

    // El loop ya incluye la pasada de cierre y el texto de respaldo si no
    // hubo texto (MAX_LOOPS agotado o respuesta vacía).
    const loop = await this.guardProviderErrors(session.sessionId, () =>
      this.agentLoop.run({
        input: contextPrefix + message,
        history,
        tools: selection.tools,
        offeredNames: selection.offeredNames,
        systemInstruction,
        ctx,
        lastInteractionId: session.lastInteractionId,
        replyLanguage: selection.replyLanguage,
      }));

    return await this.finishTurn({
      message,
      agentId,
      sessionId: session.sessionId,
      history,
      loop,
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

  /** Guarda el turno (historial, mensajes, tokens) y arma la respuesta. */
  private async finishTurn(p: {
    message: string;
    agentId: string;
    sessionId: string;
    history: AiMessage[];
    loop: AgentLoopResult;
    classifyUsage: TokenUsage | undefined;
    context: AiChatContext | null | undefined;
  }): Promise<ChatResponse> {
    const { loop } = p;
    const classifyTokens = addUsage(emptyUsage(), p.classifyUsage);
    const totalUsage = addUsage({ ...classifyTokens }, loop.usage);

    const sessionUsage = await this.store.saveTurn({
      agentId: p.agentId,
      sessionId: p.sessionId,
      history: p.history,
      messages: [
        { role: "user", content: p.message, promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        { role: "classify", content: null, ...classifyTokens },
        { role: "model", content: loop.text, ...loop.usage, interactionId: loop.lastInteractionId },
      ],
      totalUsage,
      lastInteractionId: loop.lastInteractionId,
    });

    // attachment_list se alimenta de dos fuentes complementarias: los hits de
    // RAG con documento adjunto (búsqueda vectorial) y las notas del contexto de
    // pantalla. Solo se emite si ninguna skill ya produjo su propio metadata.
    const metadata = loop.skillMetadata ?? loop.ragAttachments.buildAttachmentList(loop.citedNoteIds, p.context);

    return { text: loop.text, sessionId: p.sessionId, usage: totalUsage, sessionUsage, metadata };
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
