import type { IUsageRepository } from "./usage.repository.ts";
import { AppError, QuotaExceededError } from "../../shared/errors.ts";

export interface MonthlyUsage {
  chatCount: number;
  ingestionCount: number;
}

function currentYearMonth(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-01`;
}

export class UsageService {
  constructor(private repository: IUsageRepository) {}

  async getMonthlyUsage(agentId: string): Promise<MonthlyUsage> {
    const row = await this.repository.getMonthlyUsage(agentId, currentYearMonth());
    return { chatCount: row?.chatCount ?? 0, ingestionCount: row?.ingestionCount ?? 0 };
  }

  async checkAndIncrementChat(agentId: string): Promise<void> {
    const { error } = await this.repository.incrementUsage(agentId, "chat");
    if (error) {
      if (error.message === "quota_exceeded") {
        throw new QuotaExceededError(
          "Alcanzaste el límite de mensajes de chat este mes. Actualiza tu plan para continuar.",
        );
      }
      throw new AppError(`Error al verificar cuota de chat: ${error.message}`, 500);
    }
  }

  async checkChatQuotaOnly(agentId: string): Promise<void> {
    const [usage, limit] = await Promise.all([
      this.getMonthlyUsage(agentId),
      this.repository.getChatLimit(agentId),
    ]);
    if (usage.chatCount >= limit) {
      throw new QuotaExceededError(
        "Alcanzaste el límite de mensajes de chat este mes. Actualiza tu plan para continuar.",
      );
    }
  }

  async checkAndIncrementIngestion(agentId: string): Promise<void> {
    const { error } = await this.repository.incrementUsage(agentId, "ingestion");
    if (error) {
      if (error.message === "quota_exceeded") {
        throw new QuotaExceededError(
          "Alcanzaste el límite de ingestas este mes. Actualiza tu plan para continuar.",
        );
      }
      throw new AppError(`Error al verificar cuota de ingesta: ${error.message}`, 500);
    }
  }

  async decrementChat(agentId: string): Promise<void> {
    await this.repository.decrementUsage(agentId, "chat");
  }

  async decrementIngestion(agentId: string): Promise<void> {
    await this.repository.decrementUsage(agentId, "ingestion");
  }
}
