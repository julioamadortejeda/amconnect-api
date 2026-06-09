import type { ISubscriptionRepository } from "./subscription.repository.ts";
import type { SubscriptionInfo, SubscriptionPlan, UsageThisMonth } from "./subscription.dto.ts";
import { AppError, PaymentRequiredError } from "../../shared/errors.ts";
import { UsageService } from "./usage.service.ts";

export class SubscriptionService {
  constructor(
    private repository: ISubscriptionRepository,
    private usageService: UsageService,
  ) {}

  async getSubscriptionInfo(agentId: string): Promise<SubscriptionInfo> {
    const agentInfo = await this.repository.getAgentWithPlan(agentId);
    if (!agentInfo) throw new AppError("No se pudo obtener la información de suscripción.", 500);

    const usage = await this.getCurrentUsage(agentId);

    let trialDaysRemaining: number | null = null;
    if (agentInfo.subscriptionStatus === "trial" && agentInfo.trialEndsAt) {
      const msLeft = new Date(agentInfo.trialEndsAt).getTime() - Date.now();
      trialDaysRemaining = Math.max(0, Math.ceil(msLeft / (1000 * 60 * 60 * 24)));
    }

    return {
      plan: agentInfo.plan,
      status: agentInfo.subscriptionStatus,
      trialEndsAt: agentInfo.trialEndsAt,
      subscriptionExpiresAt: agentInfo.subscriptionExpiresAt,
      trialDaysRemaining,
      usage,
    };
  }


  async getCurrentUsage(agentId: string): Promise<UsageThisMonth> {
    const usage = await this.usageService.getMonthlyUsage(agentId);
    return { chatMessages: usage.chatCount, ingestions: usage.ingestionCount };
  }

  async checkSubscriptionActive(agentId: string): Promise<void> {
    const status = await this.repository.getAgentStatus(agentId);
    if (!status) throw new AppError("Agente no encontrado.", 404);

    if (status.subscriptionStatus === "expired" || status.subscriptionStatus === "cancelled") {
      throw new PaymentRequiredError();
    }

    if (status.subscriptionStatus === "trial" && status.trialEndsAt) {
      if (new Date(status.trialEndsAt) < new Date()) {
        await this.repository.expireAgent(agentId);
        throw new PaymentRequiredError("Tu período de prueba ha terminado. Activa un plan para continuar.");
      }
    }
  }

  async getPlans(): Promise<SubscriptionPlan[]> {
    return await this.repository.getActivePlans();
  }

  async applyPromoCode(agentId: string, code: string): Promise<{ trialEndsAt: string }> {
    const { data, error } = await this.repository.applyPromoCode(agentId, code);
    if (error) {
      if (error.message === "promo_not_found") throw new AppError("Código promocional inválido o inactivo.", 400);
      if (error.message === "promo_expired") throw new AppError("El código promocional ha expirado.", 400);
      if (error.message === "promo_max_uses_reached") throw new AppError("El código promocional ya alcanzó su límite de usos.", 400);
      throw new AppError(`Error al aplicar código promocional: ${error.message}`, 500);
    }
    return { trialEndsAt: data!.trial_ends_at };
  }
}
