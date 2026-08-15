import { SupabaseClient } from "@supabase/supabase-js";

export interface MonthlyUsageRow {
  chatCount: number;
  ingestionCount: number;
}

export interface IncrementResult {
  data: { chat_count: number; ingestion_count: number } | null;
  error: { message: string; code: string } | null;
}

export interface TokenUsageParams {
  agentId: string;
  sessionId?: string;
  documentMetadataId?: string;
  noteId?: string;
  source: "chat_text" | "chat_voice" | "extraction" | "embedding" | "summary";
  modelName: string;
  promptTokens: number;
  completionTokens: number;
  cachedTokens?: number;
}

export interface IUsageRepository {
  getMonthlyUsage(agentId: string, yearMonth: string): Promise<MonthlyUsageRow | null>;
  incrementUsage(agentId: string, field: "chat" | "ingestion"): Promise<IncrementResult>;
  decrementUsage(agentId: string, field: "chat" | "ingestion"): Promise<void>;
  getChatLimit(agentId: string): Promise<number>;
  logTokenUsage(params: TokenUsageParams): Promise<void>;
}

export class UsageRepository implements IUsageRepository {
  constructor(private supabase: SupabaseClient) {}

  async logTokenUsage(params: TokenUsageParams): Promise<void> {
    const { error } = await this.supabase
      .from("tokens_usage")
      .insert({
        agent_id: params.agentId,
        session_id: params.sessionId ?? null,
        document_metadata_id: params.documentMetadataId ?? null,
        note_id: params.noteId ?? null,
        source: params.source,
        model_name: params.modelName,
        prompt_tokens: params.promptTokens,
        completion_tokens: params.completionTokens,
        total_tokens: params.promptTokens + params.completionTokens,
        cached_tokens: params.cachedTokens ?? 0,
      });
    if (error) {
      console.error("[UsageRepository] Error inserting tokens_usage:", error);
      throw error;
    }
  }

  async getMonthlyUsage(agentId: string, yearMonth: string): Promise<MonthlyUsageRow | null> {
    const { data } = await this.supabase
      .from("agent_monthly_usage")
      .select("chat_count, ingestion_count")
      .eq("agent_id", agentId)
      .eq("year_month", yearMonth)
      .maybeSingle();

    if (!data) return null;
    return { chatCount: data.chat_count, ingestionCount: data.ingestion_count };
  }

  async incrementUsage(agentId: string, field: "chat" | "ingestion"): Promise<IncrementResult> {
    const { data, error } = await this.supabase.rpc("increment_monthly_usage", {
      p_agent_id: agentId,
      p_field: field,
    });
    return { data, error };
  }

  async decrementUsage(agentId: string, field: "chat" | "ingestion"): Promise<void> {
    await this.supabase.rpc("decrement_monthly_usage", {
      p_agent_id: agentId,
      p_field: field,
    });
  }

  async getChatLimit(agentId: string): Promise<number> {
    const { data } = await this.supabase
      .from("agents")
      .select("subscription_plans ( limits )")
      .eq("id", agentId)
      .single();
    // deno-lint-ignore no-explicit-any
    const limits = (data as any)?.subscription_plans?.limits;
    return (limits?.chat_messages_monthly as number) ?? 0;
  }
}
