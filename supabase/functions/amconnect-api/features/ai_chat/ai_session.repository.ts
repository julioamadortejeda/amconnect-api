import { SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "../../shared/errors.ts";

export interface CreateSessionData {
  agentId: string;
  triggerMessage: string;
  history: unknown[];
  type: string;
  modelName?: string | null;
  embeddingModelName?: string | null;
}

export interface UpdateSessionData {
  status?: string;
  isBillable?: boolean;
  history?: unknown[];
  promptTokens?: number;
  completionTokens?: number;
  totalTokens?: number;
  embeddingModelName?: string;
  extractionPromptTokens?: number;
  extractionCompletionTokens?: number;
  extractionTotalTokens?: number;
  embeddingTotalTokens?: number;
  embeddingCount?: number;
  metadata?: Record<string, unknown>;
}

export interface IngestionUsageRow {
  agentId: string;
  sessionId: string;
  documentMetadataId: string | null;
  operation: string;
  modelName: string;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  itemCount: number;
}

export interface ChatMessageRow {
  agentId: string;
  sessionId: string;
  role: string;
  content: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface PendingTaskRow {
  id: string;
  taskType: string;
  payload: Record<string, unknown>;
}

export interface IAiSessionRepository {
  createSession(data: CreateSessionData): Promise<string>;
  updateSession(sessionId: string, data: UpdateSessionData): Promise<void>;
  deleteSession(sessionId: string): Promise<void>;
  getSessionTokens(sessionId: string): Promise<{ promptTokens: number; completionTokens: number; totalTokens: number }>;
  getSessionContext(sessionId: string): Promise<{ history: unknown[]; type: string } | null>;
  getMetadata(sessionId: string): Promise<Record<string, unknown> | null>;
  savePendingTask(sessionId: string, agentId: string, taskType: string, payload: Record<string, unknown>): Promise<string>;
  resolvePendingTask(pendingTaskId: string, sessionId: string): Promise<void>;
  cancelPendingTasksBySession(sessionId: string): Promise<number>;
  getActivePendingTasks(sessionId: string): Promise<PendingTaskRow[]>;
  insertIngestionUsage(rows: IngestionUsageRow | IngestionUsageRow[]): Promise<void>;
  insertChatMessages(rows: ChatMessageRow[]): Promise<void>;
}

export class AiSessionRepository implements IAiSessionRepository {
  constructor(private supabase: SupabaseClient) {}

  async createSession(data: CreateSessionData): Promise<string> {
    const { data: result, error } = await this.supabase
      .from("ai_sessions")
      .insert({
        agent_id: data.agentId,
        trigger_message: data.triggerMessage,
        history: data.history,
        type: data.type,
        model_name: data.modelName ?? null,
        embedding_model_name: data.embeddingModelName ?? null,
      })
      .select("id")
      .single();

    if (error || !result) {
      throw new AppError(`No se pudo iniciar la sesión de IA: ${error?.message}`, 500);
    }
    return result.id;
  }

  async updateSession(sessionId: string, data: UpdateSessionData): Promise<void> {
    const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.status !== undefined) payload.status = data.status;
    if (data.isBillable !== undefined) payload.is_billable = data.isBillable;
    if (data.history !== undefined) payload.history = data.history;
    if (data.embeddingModelName !== undefined) payload.embedding_model_name = data.embeddingModelName;
    if (data.extractionPromptTokens !== undefined) payload.extraction_prompt_tokens = data.extractionPromptTokens;
    if (data.extractionCompletionTokens !== undefined) payload.extraction_completion_tokens = data.extractionCompletionTokens;
    if (data.extractionTotalTokens !== undefined) payload.extraction_total_tokens = data.extractionTotalTokens;
    if (data.embeddingTotalTokens !== undefined) payload.embedding_total_tokens = data.embeddingTotalTokens;
    if (data.promptTokens !== undefined) payload.prompt_tokens = data.promptTokens;
    if (data.completionTokens !== undefined) payload.completion_tokens = data.completionTokens;
    if (data.totalTokens !== undefined) payload.total_tokens = data.totalTokens;
    if (data.embeddingCount !== undefined) payload.embedding_count = data.embeddingCount;
    if (data.metadata !== undefined) payload.metadata = data.metadata;

    await this.supabase.from("ai_sessions").update(payload).eq("id", sessionId);
  }

  async getSessionTokens(sessionId: string): Promise<{ promptTokens: number; completionTokens: number; totalTokens: number }> {
    const { data } = await this.supabase
      .from("ai_sessions")
      .select("prompt_tokens, completion_tokens, total_tokens")
      .eq("id", sessionId)
      .single();
    return {
      promptTokens: data?.prompt_tokens ?? 0,
      completionTokens: data?.completion_tokens ?? 0,
      totalTokens: data?.total_tokens ?? 0,
    };
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.supabase.from("ai_sessions").delete().eq("id", sessionId);
  }

  async getSessionContext(sessionId: string): Promise<{ history: unknown[]; type: string } | null> {
    const { data } = await this.supabase
      .from("ai_sessions")
      .select("history, type")
      .eq("id", sessionId)
      .single();
    return data ?? null;
  }

  async getMetadata(sessionId: string): Promise<Record<string, unknown> | null> {
    const { data } = await this.supabase
      .from("ai_sessions")
      .select("metadata")
      .eq("id", sessionId)
      .single();
    return (data?.metadata as Record<string, unknown>) ?? null;
  }

  async cancelPendingTasksBySession(sessionId: string): Promise<number> {
    const { data } = await this.supabase
      .from("ai_pending_tasks")
      .update({ status: "cancelled", cancellation_reason: "user_left", updated_at: new Date().toISOString() })
      .eq("session_id", sessionId)
      .eq("status", "pending")
      .select("id");
    return data?.length ?? 0;
  }

  async getActivePendingTasks(sessionId: string): Promise<PendingTaskRow[]> {
    const { data } = await this.supabase
      .from("ai_pending_tasks")
      .select("id, task_type, payload")
      .eq("session_id", sessionId)
      .eq("status", "pending");
    return (data ?? []).map((t: Record<string, unknown>) => ({
      id: t.id as string,
      taskType: t.task_type as string,
      payload: t.payload as Record<string, unknown>,
    }));
  }

  async savePendingTask(sessionId: string, agentId: string, taskType: string, payload: Record<string, unknown>): Promise<string> {
    const { data, error } = await this.supabase
      .from("ai_pending_tasks")
      .insert({ session_id: sessionId, agent_id: agentId, task_type: taskType, payload, status: "pending" })
      .select("id")
      .single();
    if (error || !data) throw new Error("No se pudo guardar la tarea pendiente.");
    return data.id;
  }

  async resolvePendingTask(pendingTaskId: string, sessionId: string): Promise<void> {
    const { error } = await this.supabase
      .from("ai_pending_tasks")
      .update({ status: "confirmed", updated_at: new Date().toISOString() })
      .eq("id", pendingTaskId)
      .eq("session_id", sessionId);
    if (error) throw new Error("No se pudo resolver la tarea pendiente.");
  }

  async insertIngestionUsage(rows: IngestionUsageRow | IngestionUsageRow[]): Promise<void> {
    const toInsert = Array.isArray(rows) ? rows : [rows];
    await this.supabase.from("ai_ingestion_usage").insert(
      toInsert.map((r) => ({
        agent_id: r.agentId,
        session_id: r.sessionId,
        document_metadata_id: r.documentMetadataId,
        operation: r.operation,
        model_name: r.modelName,
        prompt_tokens: r.promptTokens,
        completion_tokens: r.completionTokens,
        total_tokens: r.totalTokens,
        item_count: r.itemCount,
      })),
    );
  }

  async insertChatMessages(rows: ChatMessageRow[]): Promise<void> {
    const { error } = await this.supabase.from("ai_chat_messages").insert(
      rows.map((r) => ({
        agent_id: r.agentId,
        session_id: r.sessionId,
        role: r.role,
        content: r.content,
        prompt_tokens: r.promptTokens,
        completion_tokens: r.completionTokens,
        total_tokens: r.totalTokens,
      })),
    );
    if (error) {
      throw new AppError(`No se pudieron guardar los mensajes del chat: ${error.message}`, 500);
    }
  }


}
