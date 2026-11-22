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
import { DomainToolSelector, type ToolSelection, type ToolSelector } from "./tool_selector.ts";
import { AgentLoop, type AgentLoopOutcome } from "./agent_loop.ts";
import type { AgentEventListener, AgentLoopResult } from "./agent_events.ts";
import { activeTurns, type ActiveTurnRegistry } from "./active_turns.ts";
import { addUsage, emptyUsage } from "./token_usage.ts";

export interface ChatResponse {
  text: string;
  sessionId: string;
  usage: UsageTokens;
  sessionUsage?: UsageTokens;
  metadata?: Record<string, unknown>;
}

/** Un mensaje del asesor y lo que lo rodea (headers del request). */
export interface ChatTurnRequest {
  message: string;
  agentId: string;
  sessionId?: string | null;
  timezone?: string;
  context?: AiChatContext | null;
  advisorLocale?: string;
}

/** Opciones del turno en streaming (SSE). */
export interface StreamTurnOptions {
  /** Eventos del AgentLoop, tal cual (el transporte decide qué mostrar). */
  onEvent?: AgentEventListener;
  /** Desconexión del cliente (§7.3): el loop se detiene antes de la siguiente llamada o herramienta. */
  signal?: AbortSignal;
  /** Se llama en cuanto se conoce el id de la sesión (también si es nueva). */
  onSessionOpened?: (sessionId: string) => void | Promise<void>;
}

export type ChatTurnOutcome =
  | { status: "done"; response: ChatResponse }
  /** Se detuvo a medias: se guardó lo ocurrido y la sesión quedó `cancelled`. */
  | { status: "cancelled"; sessionId: string; modelCalls: number };

interface OpenedSession {
  sessionId: string;
  history: AiMessage[];
  type: string;
  lastInteractionId: string | undefined;
}

/** Lo que el AgentLoop necesita del turno, ya armado. */
interface PreparedTurn {
  session: OpenedSession;
  /** Largo del historial antes de agregar el mensaje de este turno. */
  priorHistoryLength: number;
  input: string;
  selection: ToolSelection;
  systemInstruction: string;
  ctx: SkillContext;
}

export class AiChatService {
  private store: ConversationStore;
  private toolSelector: ToolSelector;
  private agentLoop: AgentLoop;
  private activeTurns: ActiveTurnRegistry;

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
    activeTurnRegistry?: ActiveTurnRegistry,
  ) {
    this.store = store ?? new SessionConversationStore(aiSessionService);
    this.toolSelector = toolSelector ?? new DomainToolSelector(aiProvider, toolSelectionMode);
    this.agentLoop = agentLoop ?? new AgentLoop(aiProvider);
    this.activeTurns = activeTurnRegistry ?? activeTurns;
  }

  /**
   * Cancela las tareas pendientes de la sesión y, si en ESTA instancia hay un
   * turno en curso de esa sesión, lo detiene. `cancelledTurn` solo aparece
   * cuando sí había uno (la respuesta de siempre no cambia).
   */
  async cancelSession(sessionId: string): Promise<{ cancelledTasks: number; cancelledTurn?: true }> {
    // Primero la sesión (404 si es ajena): el registro es del isolate y lo
    // comparten todos los asesores, así que nunca se aborta sin verificar.
    const result = await this.aiSessionService.cancelSession(sessionId);
    return this.activeTurns.cancel(sessionId) ? { ...result, cancelledTurn: true } : result;
  }

  async processMessage(
    message: string,
    agentId: string,
    sessionId?: string | null,
    timezone?: string,
    context?: AiChatContext | null,
    _newSessionType: "chat" = "chat",
    advisorLocale?: string,
  ): Promise<ChatResponse> {
    // Sesión existente: candado de turno ANTES de cualquier gasto (clasificador,
    // modelo). Dos mensajes simultáneos hacían leer-modificar-escribir del
    // historial y el último pisaba al primero (bug #6); el segundo recibe 409.
    // Sesión nueva: sin candado, nadie conoce su id hasta que este turno
    // responde, así que no puede haber un segundo mensaje concurrente.
    await this.acquireTurn(sessionId);
    try {
      const outcome = await this.runTurn({ message, agentId, sessionId, timezone, context, advisorLocale });
      return expectDone(outcome);
    } finally {
      if (sessionId) await this.store.releaseTurnLock(sessionId);
    }
  }

  /**
   * Primer paso del turno en streaming: toma el candado ANTES de abrir el
   * stream, para que 404/409 salgan como status HTTP. Quien lo llama DEBE
   * seguir con `processLockedTurn`, que lo suelta.
   */
  async acquireTurn(sessionId?: string | null): Promise<void> {
    if (sessionId) await this.store.acquireTurnLock(sessionId);
  }

  /** Corre un turno con el candado ya tomado (`acquireTurn`) y lo suelta al terminar. Cancelable. */
  async processLockedTurn(req: ChatTurnRequest, opts: StreamTurnOptions = {}): Promise<ChatTurnOutcome> {
    try {
      return await this.runTurn(req, opts, true);
    } finally {
      if (req.sessionId) await this.store.releaseTurnLock(req.sessionId);
    }
  }

  private async runTurn(req: ChatTurnRequest, opts: StreamTurnOptions = {}, cancellable = false): Promise<ChatTurnOutcome> {
    const session = await this.openSession(req.message, req.agentId, req.sessionId);
    await opts.onSessionOpened?.(session.sessionId);
    const active = cancellable ? this.activeTurns.register(session.sessionId) : null;
    try {
      const turn = await this.prepareTurn(req, session);
      const signal = combineSignals(opts.signal, active?.signal);
      // El loop ya incluye la pasada de cierre y el texto de respaldo si no
      // hubo texto (MAX_LOOPS agotado o respuesta vacía).
      const loop = await this.guardProviderErrors(session.sessionId, () => this.runLoop(turn, opts.onEvent, signal));
      if (loop.cancelled) return await this.finishCancelledTurn(req, turn, loop);
      const response = await this.finishTurn({
        message: req.message,
        agentId: req.agentId,
        sessionId: session.sessionId,
        history: session.history,
        loop,
        classifyUsage: turn.selection.classifyUsage,
        context: req.context,
      });
      return { status: "done", response };
    } finally {
      active?.release();
    }
  }

  /** Herramientas, prompt, [CONTEXT] y SkillContext del turno; agrega el mensaje al historial. */
  private async prepareTurn(req: ChatTurnRequest, session: OpenedSession): Promise<PreparedTurn> {
    const { history } = session;
    const pendingTasks = await this.store.getPendingTasks(session.sessionId);

    const selection = await this.toolSelector.select({
      message: req.message,
      context: req.context,
      pendingTasks,
      sessionType: session.type,
      history,
      advisorLocale: req.advisorLocale,
    });

    const isPolicyIngestion = session.type === "policy_ingestion";
    // System instruction ESTÁTICO: nada se sustituye aquí. Lo que cambia por
    // request —fecha, idioma, pending tasks, pantalla activa— va en el mensaje
    // del usuario (abajo), así el implicit caching de Gemini lo comparte entre
    // todos los asesores (medido el 2026-09-07: 12,078 de 13,270 tokens cacheados).
    const dbPromptCode = isPolicyIngestion ? "policy_ingestion_system" : "ai_chat_system";
    const systemInstruction = await this.promptService.getPrompt(dbPromptCode, {});

    // Fecha y hora local del asesor — implementación compartida con voz
    const { localIso, offsetStr } = buildLocalDateTime(req.timezone || DEFAULT_TIMEZONE);
    const contextPrefix = buildContextPrefix({
      localIso,
      offsetStr,
      replyLanguage: selection.replyLanguage,
      pendingTasks,
      context: req.context,
    });
    const priorHistoryLength = history.length;
    history.push({ role: AiRole.USER, parts: [{ text: contextPrefix + req.message }] });

    const ctx: SkillContext = {
      agentId: req.agentId,
      sessionId: session.sessionId,
      aiSessionService: this.aiSessionService,
      ...this.skillContext,
      timezone: req.timezone || "America/Mexico_City",
      timezoneOffset: offsetStr || "-06:00",
      advisorWords: collectAdvisorWords(history),
    };

    return { session, priorHistoryLength, input: contextPrefix + req.message, selection, systemInstruction, ctx };
  }

  private runLoop(turn: PreparedTurn, onEvent?: AgentEventListener, signal?: AbortSignal): Promise<AgentLoopOutcome> {
    return this.agentLoop.run({
      input: turn.input,
      history: turn.session.history,
      tools: turn.selection.tools,
      offeredNames: turn.selection.offeredNames,
      systemInstruction: turn.systemInstruction,
      ctx: turn.ctx,
      lastInteractionId: turn.session.lastInteractionId,
      replyLanguage: turn.selection.replyLanguage,
      onEvent,
      signal,
    });
  }

  /** Carga la sesión existente (404 si no es tuya) o crea una nueva. */
  private async openSession(
    message: string,
    agentId: string,
    sessionId: string | null | undefined,
  ): Promise<OpenedSession> {
    const newSessionType = "chat";
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

  /**
   * Turno cancelado (§7.3). Se guarda lo que SÍ ocurrió: si el modelo ya pidió
   * herramientas, el historial lleva sus llamadas y respuestas (el loop
   * rellena las que no corrieron), para que el siguiente mensaje sepa qué se
   * escribió. Sin ninguna llamada al modelo no pasó nada y el historial queda
   * como estaba. Los tokens gastados (clasificador incluido) se registran.
   *
   * `lastInteractionId` NO avanza: la última interacción del turno terminó en
   * function calls cuyas respuestas nunca se mandaron, y seguir desde ahí con
   * un mensaje de texto rompería la cadena del Interactions API (studio).
   */
  private async finishCancelledTurn(
    req: ChatTurnRequest,
    turn: PreparedTurn,
    loop: AgentLoopOutcome,
  ): Promise<ChatTurnOutcome> {
    const { session } = turn;
    const classifyTokens = addUsage(emptyUsage(), turn.selection.classifyUsage);
    const history = loop.modelCalls > 0 ? session.history : session.history.slice(0, turn.priorHistoryLength);
    await this.store.saveTurn({
      agentId: req.agentId,
      sessionId: session.sessionId,
      history,
      messages: [
        { role: "user", content: req.message, promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        { role: "classify", content: null, ...classifyTokens },
        { role: "model", content: null, ...loop.usage },
      ],
      totalUsage: addUsage({ ...classifyTokens }, loop.usage),
      lastInteractionId: session.lastInteractionId,
    });
    await this.store.markTurnCancelled(session.sessionId);
    return { status: "cancelled", sessionId: session.sessionId, modelCalls: loop.modelCalls };
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

/** El endpoint JSON no pasa señal de cancelación: su turno siempre termina en `done`. */
function expectDone(outcome: ChatTurnOutcome): ChatResponse {
  if (outcome.status !== "done") throw new AppError("El turno se canceló.", 500);
  return outcome.response;
}

function combineSignals(...signals: (AbortSignal | undefined)[]): AbortSignal | undefined {
  const present = signals.filter((s): s is AbortSignal => s !== undefined);
  if (present.length <= 1) return present[0];
  return AbortSignal.any(present);
}
