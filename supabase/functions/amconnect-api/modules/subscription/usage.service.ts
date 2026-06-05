import { SupabaseClient } from "@supabase/supabase-js";
import { PlanLimits } from "./subscription.dto.ts";
import { QuotaExceededError } from "../../shared/errors.ts";

export interface MonthlyUsage {
  chatCount: number;
  ingestionCount: number;
}

function currentYearMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export class UsageService {
  constructor(private supabase: SupabaseClient) {}

  async getMonthlyUsage(agentId: string): Promise<MonthlyUsage> {
    const { data } = await this.supabase
      .from("agent_monthly_usage")
      .select("chat_count, ingestion_count")
      .eq("agent_id", agentId)
      .eq("year_month", currentYearMonth())
      .maybeSingle();

    return {
      chatCount: data?.chat_count ?? 0,
      ingestionCount: data?.ingestion_count ?? 0,
    };
  }

  async checkAndIncrementChat(agentId: string, limits: PlanLimits): Promise<void> {
    const usage = await this.getMonthlyUsage(agentId);
    if (usage.chatCount >= limits.chat_messages_monthly) {
      throw new QuotaExceededError(
        `Alcanzaste el límite de ${limits.chat_messages_monthly} mensajes de chat este mes. Actualiza tu plan para continuar.`,
      );
    }
    await this.supabase.rpc("increment_monthly_usage", { p_agent_id: agentId, p_field: "chat" });
  }

  async checkAndIncrementIngestion(agentId: string, limits: PlanLimits): Promise<void> {
    const usage = await this.getMonthlyUsage(agentId);
    if (usage.ingestionCount >= limits.ingestions_monthly) {
      throw new QuotaExceededError(
        `Alcanzaste el límite de ${limits.ingestions_monthly} ingestas este mes. Actualiza tu plan para continuar.`,
      );
    }
    await this.supabase.rpc("increment_monthly_usage", { p_agent_id: agentId, p_field: "ingestion" });
  }
}
