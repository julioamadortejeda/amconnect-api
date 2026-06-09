import { SupabaseClient } from "@supabase/supabase-js";

export interface MonthlyUsageRow {
  chatCount: number;
  ingestionCount: number;
}

export interface IncrementResult {
  data: { chat_count: number; ingestion_count: number } | null;
  error: { message: string; code: string } | null;
}

export interface IUsageRepository {
  getMonthlyUsage(agentId: string, yearMonth: string): Promise<MonthlyUsageRow | null>;
  incrementUsage(agentId: string, field: "chat" | "ingestion"): Promise<IncrementResult>;
  decrementUsage(agentId: string, field: "chat" | "ingestion"): Promise<void>;
}

export class UsageRepository implements IUsageRepository {
  constructor(private supabase: SupabaseClient) {}

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
}
