// Persistencia de una conversación de chat: leer la sesión, el candado del turno
// y guardar el turno. Es una fachada sobre AiSessionService (no duplica SQL):
// el motor del chat depende de esta interfaz y las pruebas la sustituyen.
import type { AiMessage } from "../../core/ai_provider.interface.ts";
import { NotFoundError } from "../../shared/errors.ts";
import type { AiSessionService, ChatMessageInput, CreateSessionInput, UsageTokens } from "./ai_session.service.ts";
import type { PendingTaskRow } from "./ai_session.repository.ts";

/** Lo que el turno necesita saber de una sesión ya existente. */
export interface LoadedSession {
  history: AiMessage[];
  type: string | undefined;
  lastInteractionId: string | undefined;
}

export interface SavedTurn {
  agentId: string;
  sessionId: string;
  history: AiMessage[];
  messages: ChatMessageInput[];
  totalUsage: UsageTokens;
  lastInteractionId?: string;
}

export interface ConversationStore {
  /** Lee la sesión; 404 si no existe o es de otro asesor (el RLS devuelve null). */
  loadSession(sessionId: string): Promise<LoadedSession>;
  createSession(agentId: string, input: CreateSessionInput): Promise<string>;
  getPendingTasks(sessionId: string): Promise<PendingTaskRow[]>;
  acquireTurnLock(sessionId: string): Promise<void>;
  releaseTurnLock(sessionId: string): Promise<void>;
  /** Historial + ai_chat_messages + tokens_usage; devuelve el acumulado de la sesión. */
  saveTurn(turn: SavedTurn): Promise<UsageTokens>;
  /** Falla del proveedor: la sesión deja de ser facturable. */
  markProviderError(sessionId: string, errorMessage: string): Promise<void>;
}

export class SessionConversationStore implements ConversationStore {
  constructor(private sessions: AiSessionService) {}

  async loadSession(sessionId: string): Promise<LoadedSession> {
    const session = await this.sessions.getSessionContext(sessionId);
    // Rechazar ANTES de invocar al modelo: tratarla como vacía gastaba tokens
    // y tronaba al guardar.
    if (!session) throw new NotFoundError("Sesión no encontrada.");
    return {
      history: [...((session.history ?? []) as AiMessage[])],
      type: session.type ?? undefined,
      lastInteractionId: session.last_interaction_id ?? undefined,
    };
  }

  createSession(agentId: string, input: CreateSessionInput): Promise<string> {
    return this.sessions.createSession(agentId, input);
  }

  getPendingTasks(sessionId: string): Promise<PendingTaskRow[]> {
    return this.sessions.getActivePendingTasks(sessionId);
  }

  acquireTurnLock(sessionId: string): Promise<void> {
    return this.sessions.acquireTurnLock(sessionId);
  }

  releaseTurnLock(sessionId: string): Promise<void> {
    return this.sessions.releaseTurnLock(sessionId);
  }

  saveTurn(t: SavedTurn): Promise<UsageTokens> {
    return this.sessions.saveChatRound(t.agentId, t.sessionId, t.history, t.messages, t.totalUsage, t.lastInteractionId);
  }

  markProviderError(sessionId: string, errorMessage: string): Promise<void> {
    return this.sessions.markSessionProviderError(sessionId, errorMessage);
  }
}
