import { SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "../../shared/errors.ts";

export interface CreateSessionInput {
  triggerMessage: string;
  sessionType: "chat" | "knowledge_ingestion" | "policy_ingestion";
  modelName?: string | null;
  embeddingModelName?: string | null;
}

export interface UsageTokens {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export interface ChatMessageInput {
  role: string;
  content: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
}

export class AiSessionService {
  constructor(private supabase: SupabaseClient) {}

  async createSession(agentId: string, input: CreateSessionInput): Promise<string> {
    const { data, error } = await this.supabase
      .from("ai_sessions")
      .insert({
        agent_id: agentId,
        trigger_message: input.triggerMessage,
        history: [],
        session_type: input.sessionType,
        model_name: input.modelName ?? Deno.env.get("GEMINI_MODEL") ?? "gemini-3.1-flash-lite",
        embedding_model_name: input.embeddingModelName,
      })
      .select("id")
      .single();

    if (error || !data) {
      throw new AppError(`No se pudo iniciar la sesión de IA: ${error?.message}`, 500);
    }
    return data.id;
  }

  async trackIngestionUsage(
    agentId: string,
    sessionId: string,
    docMetaId: string | null,
    extractionModelName: string,
    extractionUsage: UsageTokens | undefined,
    embeddingModelName: string,
    embeddingTotalTokens: number,
    embeddingCount: number,
  ): Promise<void> {
    // 1. Guardar uso detallado
    await this.supabase.from("ai_ingestion_usage").insert([
      {
        agent_id: agentId,
        session_id: sessionId,
        document_metadata_id: docMetaId,
        operation: "extraction",
        model_name: extractionModelName,
        prompt_tokens: extractionUsage?.promptTokens ?? 0,
        completion_tokens: extractionUsage?.completionTokens ?? 0,
        total_tokens: extractionUsage?.totalTokens ?? 0,
        item_count: 1,
      },
      {
        agent_id: agentId,
        session_id: sessionId,
        document_metadata_id: docMetaId,
        operation: "embedding",
        model_name: embeddingModelName,
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: embeddingTotalTokens,
        item_count: embeddingCount,
      },
    ]);

    // 2. Actualizar cabecera
    await this.supabase
      .from("ai_sessions")
      .update({
        embedding_model_name: embeddingModelName,
        extraction_prompt_tokens: extractionUsage?.promptTokens ?? 0,
        extraction_completion_tokens: extractionUsage?.completionTokens ?? 0,
        extraction_total_tokens: extractionUsage?.totalTokens ?? 0,
        embedding_total_tokens: embeddingTotalTokens,
        embedding_count: embeddingCount,
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId);
  }

  async trackExtractionUsageOnly(
    agentId: string,
    sessionId: string,
    docMetaId: string | null,
    extractionModelName: string,
    extractionUsage: UsageTokens | undefined,
  ): Promise<void> {
    await this.supabase.from("ai_ingestion_usage").insert({
      agent_id: agentId,
      session_id: sessionId,
      document_metadata_id: docMetaId,
      operation: "extraction",
      model_name: extractionModelName,
      prompt_tokens: extractionUsage?.promptTokens ?? 0,
      completion_tokens: extractionUsage?.completionTokens ?? 0,
      total_tokens: extractionUsage?.totalTokens ?? 0,
      item_count: 1,
    });

    await this.supabase
      .from("ai_sessions")
      .update({
        extraction_prompt_tokens: extractionUsage?.promptTokens ?? 0,
        extraction_completion_tokens: extractionUsage?.completionTokens ?? 0,
        extraction_total_tokens: extractionUsage?.totalTokens ?? 0,
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId);
  }

  async trackEmbeddingUsageOnly(
    agentId: string,
    sessionId: string,
    docMetaId: string | null,
    embeddingModelName: string,
    embeddingTotalTokens: number,
    embeddingCount: number,
  ): Promise<void> {
    // 1. Guardar uso detallado
    await this.supabase.from("ai_ingestion_usage").insert({
      agent_id: agentId,
      session_id: sessionId,
      document_metadata_id: docMetaId,
      operation: "embedding",
      model_name: embeddingModelName,
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: embeddingTotalTokens,
      item_count: embeddingCount,
    });

    // 2. Actualizar cabecera
    await this.supabase
      .from("ai_sessions")
      .update({
        embedding_model_name: embeddingModelName,
        embedding_total_tokens: embeddingTotalTokens,
        embedding_count: embeddingCount,
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId);
  }

  async incrementChatUsage(
    sessionId: string,
    promptTokens: number,
    completionTokens: number,
    totalTokens: number,
  ): Promise<void> {
    const { error } = await this.supabase.rpc("increment_session_usage", {
      p_session_id: sessionId,
      p_prompt_tokens: promptTokens,
      p_completion_tokens: completionTokens,
      p_total_tokens: totalTokens,
    });
    if (error) {
      console.error(`[AiSessionService] Error incrementando uso de sesión: ${error.message}`);
    }
  }

  async saveChatRound(
    agentId: string,
    sessionId: string,
    history: unknown[],
    messages: ChatMessageInput[],
    totalUsage: UsageTokens,
  ): Promise<void> {
    const chatMessageRows = messages.map((m) => ({
      agent_id: agentId,
      session_id: sessionId,
      role: m.role,
      content: m.content,
      prompt_tokens: m.promptTokens,
      completion_tokens: m.completionTokens,
      total_tokens: m.totalTokens,
    }));

    const [, { error: msgError }] = await Promise.all([
      this.supabase.from("ai_sessions")
        .update({ history, updated_at: new Date().toISOString() })
        .eq("id", sessionId),
      this.supabase.from("ai_chat_messages").insert(chatMessageRows),
      this.incrementChatUsage(sessionId, totalUsage.promptTokens, totalUsage.completionTokens, totalUsage.totalTokens),
    ]);

    if (msgError) {
      throw new AppError(`No se pudieron guardar los mensajes del chat: ${msgError.message}`, 500);
    }
  }

  async updateMetadata(sessionId: string, metadata: Record<string, unknown>): Promise<void> {
    await this.supabase
      .from("ai_sessions")
      .update({
        metadata,
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId);
  }

  /**
   * Marks a session as failed and records the error message in its metadata.
   * Use when the AI provider was already invoked (tokens consumed) and a
   * subsequent step (e.g. vectorization, DB insert) fails.
   */
  async markSessionFailed(sessionId: string, errorMessage: string): Promise<void> {
    await this.supabase
      .from("ai_sessions")
      .update({
        status: "failed",
        metadata: { error: errorMessage },
        updated_at: new Date().toISOString(),
      })
      .eq("id", sessionId);
  }

  /**
   * Deletes a session entirely.
   * Use when the AI provider was NOT yet invoked and an error occurs
   * (e.g. file download failed), so no orphan/empty sessions are left behind.
   */
  async deleteSession(sessionId: string): Promise<void> {
    await this.supabase
      .from("ai_sessions")
      .delete()
      .eq("id", sessionId);
  }
}
