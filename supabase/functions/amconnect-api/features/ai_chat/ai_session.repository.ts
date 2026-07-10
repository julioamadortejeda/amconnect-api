import { SupabaseClient } from "@supabase/supabase-js";
import { AppError, internalError } from "../../shared/errors.ts";

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
  embeddingModelName?: string;
  ttsModelName?: string;
  ttsPromptTokens?: number;
  ttsCompletionTokens?: number;
  ttsTotalTokens?: number;
  metadata?: Record<string, unknown>;
  lastInteractionId?: string | null;
  durationSeconds?: number;
}



export interface ChatMessageRow {
  agentId: string;
  sessionId: string;
  role: string;
  content: string | null;
  interactionId?: string | null;
}

export interface TokenUsageRow {
  agentId: string;
  sessionId?: string | null;
  documentMetadataId?: string | null;
  noteId?: string | null;
  source: "chat_text" | "chat_voice" | "extraction" | "embedding" | "summary";
  modelName: string;
  promptTokens: number;
  completionTokens: number;
  cachedTokens?: number;
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
  getSessionTokens(sessionId: string): Promise<{ promptTokens: number; completionTokens: number; totalTokens: number; cachedTokens: number }>;
  getSessionTtsTokens(sessionId: string): Promise<{ promptTokens: number; completionTokens: number; totalTokens: number }>;
  getSessionContext(sessionId: string): Promise<{ history: unknown[]; type: string; modelName?: string | null; last_interaction_id?: string | null; createdAt?: string } | null>;
  getMetadata(sessionId: string): Promise<Record<string, unknown> | null>;
  savePendingTask(sessionId: string, agentId: string, taskType: string, payload: Record<string, unknown>): Promise<string>;
  resolvePendingTask(pendingTaskId: string, sessionId: string): Promise<void>;
  cancelPendingTasksBySession(sessionId: string): Promise<number>;
  getActivePendingTasks(sessionId: string): Promise<PendingTaskRow[]>;
  insertChatMessages(rows: ChatMessageRow[]): Promise<void>;
  logTokenUsage(rows: TokenUsageRow | TokenUsageRow[]): Promise<void>;
  getSessionTokenUsageDetails(sessionId: string): Promise<{
    chat: { promptTokens: number; completionTokens: number; totalTokens: number; cachedTokens: number };
    extraction: { promptTokens: number; completionTokens: number; totalTokens: number; cachedTokens: number };
    embedding: { promptTokens: number; completionTokens: number; totalTokens: number; cachedTokens: number };
    summary: { promptTokens: number; completionTokens: number; totalTokens: number; cachedTokens: number };
  }>;
  getSessionWithRates(sessionId: string): Promise<Record<string, any> | null>;
}

export class AiSessionRepository implements IAiSessionRepository {
  constructor(private supabase: SupabaseClient) {}

  async logTokenUsage(rows: TokenUsageRow | TokenUsageRow[]): Promise<void> {
    const toInsert = Array.isArray(rows) ? rows : [rows];
    const { error } = await this.supabase.from("tokens_usage").insert(
      toInsert.map((r) => ({
        agent_id: r.agentId,
        session_id: r.sessionId ?? null,
        document_metadata_id: r.documentMetadataId ?? null,
        note_id: r.noteId ?? null,
        source: r.source,
        model_name: r.modelName,
        prompt_tokens: r.promptTokens,
        completion_tokens: r.completionTokens,
        total_tokens: r.promptTokens + r.completionTokens,
        cached_tokens: r.cachedTokens ?? 0,
      })),
    );
    if (error) {
      console.error("[AiSessionRepository] Error inserting tokens_usage:", error);
      throw error;
    }
  }

  async getSessionTokenUsageDetails(sessionId: string): Promise<{
    chat: { promptTokens: number; completionTokens: number; totalTokens: number; cachedTokens: number };
    extraction: { promptTokens: number; completionTokens: number; totalTokens: number; cachedTokens: number };
    embedding: { promptTokens: number; completionTokens: number; totalTokens: number; cachedTokens: number };
    summary: { promptTokens: number; completionTokens: number; totalTokens: number; cachedTokens: number };
  }> {
    const { data } = await this.supabase
      .from("tokens_usage")
      .select("source, prompt_tokens, completion_tokens, total_tokens, cached_tokens")
      .eq("session_id", sessionId);

    const usage = {
      chat: { promptTokens: 0, completionTokens: 0, totalTokens: 0, cachedTokens: 0 },
      extraction: { promptTokens: 0, completionTokens: 0, totalTokens: 0, cachedTokens: 0 },
      embedding: { promptTokens: 0, completionTokens: 0, totalTokens: 0, cachedTokens: 0 },
      summary: { promptTokens: 0, completionTokens: 0, totalTokens: 0, cachedTokens: 0 },
    };

    if (!data) return usage;

    for (const row of data) {
      const prompt = row.prompt_tokens ?? 0;
      const completion = row.completion_tokens ?? 0;
      const total = row.total_tokens ?? 0;
      const cached = row.cached_tokens ?? 0;

      if (row.source === "chat_text" || row.source === "chat_voice") {
        usage.chat.promptTokens += prompt;
        usage.chat.completionTokens += completion;
        usage.chat.totalTokens += total;
        usage.chat.cachedTokens += cached;
      } else if (row.source === "extraction") {
        usage.extraction.promptTokens += prompt;
        usage.extraction.completionTokens += completion;
        usage.extraction.totalTokens += total;
        usage.extraction.cachedTokens += cached;
      } else if (row.source === "embedding") {
        usage.embedding.promptTokens += prompt;
        usage.embedding.completionTokens += completion;
        usage.embedding.totalTokens += total;
        usage.embedding.cachedTokens += cached;
      } else if (row.source === "summary") {
        usage.summary.promptTokens += prompt;
        usage.summary.completionTokens += completion;
        usage.summary.totalTokens += total;
        usage.summary.cachedTokens += cached;
      }
    }
    return usage;
  }

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
      throw internalError("No se pudo iniciar la sesión de IA.", `createSession failed: ${error?.message}`);
    }
    return result.id;
  }

  async updateSession(sessionId: string, data: UpdateSessionData): Promise<void> {
    const payload: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (data.status !== undefined) payload.status = data.status;
    if (data.isBillable !== undefined) payload.is_billable = data.isBillable;
    if (data.history !== undefined) payload.history = data.history;
    if (data.embeddingModelName !== undefined) payload.embedding_model_name = data.embeddingModelName;
    if (data.ttsModelName !== undefined) payload.tts_model_name = data.ttsModelName;
    if (data.ttsPromptTokens !== undefined) payload.tts_prompt_tokens = data.ttsPromptTokens;
    if (data.ttsCompletionTokens !== undefined) payload.tts_completion_tokens = data.ttsCompletionTokens;
    if (data.ttsTotalTokens !== undefined) payload.tts_total_tokens = data.ttsTotalTokens;
    if (data.metadata !== undefined) payload.metadata = data.metadata;
    if (data.lastInteractionId !== undefined) payload.last_interaction_id = data.lastInteractionId;
    if (data.durationSeconds !== undefined) payload.duration_seconds = data.durationSeconds;

    await this.supabase.from("ai_sessions").update(payload).eq("id", sessionId);
  }

  async getSessionTokens(sessionId: string): Promise<{ promptTokens: number; completionTokens: number; totalTokens: number; cachedTokens: number }> {
    const { data, error } = await this.supabase
      .from("tokens_usage")
      .select("prompt_tokens, completion_tokens, total_tokens, cached_tokens")
      .eq("session_id", sessionId);

    if (error || !data) {
      return { promptTokens: 0, completionTokens: 0, totalTokens: 0, cachedTokens: 0 };
    }

    let promptTokens = 0;
    let completionTokens = 0;
    let totalTokens = 0;
    let cachedTokens = 0;

    for (const row of data) {
      promptTokens += row.prompt_tokens ?? 0;
      completionTokens += row.completion_tokens ?? 0;
      totalTokens += row.total_tokens ?? 0;
      cachedTokens += row.cached_tokens ?? 0;
    }

    return { promptTokens, completionTokens, totalTokens, cachedTokens };
  }

  async getSessionTtsTokens(sessionId: string): Promise<{ promptTokens: number; completionTokens: number; totalTokens: number }> {
    const { data } = await this.supabase
      .from("ai_sessions")
      .select("tts_prompt_tokens, tts_completion_tokens, tts_total_tokens")
      .eq("id", sessionId)
      .single();
    return {
      promptTokens: data?.tts_prompt_tokens ?? 0,
      completionTokens: data?.tts_completion_tokens ?? 0,
      totalTokens: data?.tts_total_tokens ?? 0,
    };
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.supabase.from("ai_sessions").delete().eq("id", sessionId);
  }

  async getSessionContext(sessionId: string): Promise<{ history: unknown[]; type: string; modelName?: string | null; last_interaction_id?: string | null; createdAt?: string } | null> {
    const { data } = await this.supabase
      .from("ai_sessions")
      .select("history, type, model_name, last_interaction_id, created_at")
      .eq("id", sessionId)
      .single();
    if (!data) return null;
    return {
      history: data.history ?? [],
      type: data.type,
      modelName: data.model_name,
      last_interaction_id: data.last_interaction_id,
      createdAt: data.created_at,
    };
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



  async insertChatMessages(rows: ChatMessageRow[]): Promise<void> {
    const { error } = await this.supabase.from("ai_chat_messages").insert(
      rows.map((r) => ({
        agent_id: r.agentId,
        session_id: r.sessionId,
        role: r.role,
        content: r.content,
        interaction_id: r.interactionId ?? null,
      })),
    );
    if (error) {
      throw internalError("No se pudieron guardar los mensajes del chat.", `saveChatRound failed: ${error.message}`);
    }
  }

  async getSessionWithRates(sessionId: string): Promise<Record<string, any> | null> {
    const { data, error } = await this.supabase
      .from("ai_sessions")
      .select(`
        id,
        model_name,
        embedding_model_name,
        tts_model_name,
        tts_prompt_tokens,
        tts_completion_tokens,
        tts_total_tokens,
        chat_model:model_name(model_name, provider, display_name, input_cost_per_1m, output_cost_per_1m, cache_read_cost_per_1m),
        embedding_model:embedding_model_name(model_name, provider, display_name, input_cost_per_1m, output_cost_per_1m),
        tts_model:tts_model_name(model_name, provider, display_name, input_cost_per_1m, output_cost_per_1m)
      `)
      .eq("id", sessionId)
      .single();

    if (error) {
      throw internalError("No se pudo obtener el costo de la sesión.", `getSessionCost failed: ${error.message}`, 404);
    }
    return data;
  }
}
