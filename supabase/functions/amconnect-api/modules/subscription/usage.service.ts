import type { IUsageRepository, TokenUsageParams } from "./usage.repository.ts";
import { AppError, QuotaExceededError, internalError } from "../../shared/errors.ts";

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

  /** Cobra un mensaje y devuelve el id del cobro, que es lo único con que se puede devolver. */
  async checkAndIncrementChat(agentId: string): Promise<string> {
    const { data, error } = await this.repository.incrementUsage(agentId, "chat");
    if (error) {
      if (error.message === "quota_exceeded") {
        throw new QuotaExceededError(
          "Alcanzaste el límite de mensajes de chat este mes. Actualiza tu plan para continuar.",
        );
      }
      throw internalError("No se pudo verificar tu cuota de mensajes.", `chat quota check failed: ${error.message}`);
    }
    return data!.charge_id;
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

  /** Cobra una ingesta y devuelve el id del cobro, que es lo único con que se puede devolver. */
  async checkAndIncrementIngestion(agentId: string): Promise<string> {
    const { data, error } = await this.repository.incrementUsage(agentId, "ingestion");
    if (error) {
      if (error.message === "quota_exceeded") {
        throw new QuotaExceededError(
          "Alcanzaste el límite de ingestas este mes. Actualiza tu plan para continuar.",
        );
      }
      throw internalError("No se pudo verificar tu cuota de ingestas.", `ingestion quota check failed: ${error.message}`);
    }
    return data!.charge_id;
  }

  /** Devuelve un cobro de chat o de ingesta. `null` = no se cobró, no hay nada que devolver. */
  async refundCharge(chargeId: string | null): Promise<void> {
    if (!chargeId) return;
    await this.repository.refundCharge(chargeId);
  }

  async logTokenUsage(params: TokenUsageParams): Promise<void> {
    await this.repository.logTokenUsage(params);
  }
}
