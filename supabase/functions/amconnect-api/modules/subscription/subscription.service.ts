import type { AgentStatusInfo, ISubscriptionRepository } from "./subscription.repository.ts";
import type { SubscriptionInfo, SubscriptionPlan, UsageThisMonth } from "./subscription.dto.ts";
import {
  AppError,
  NotFoundError,
  PaymentRequiredError,
  PromoCodeError,
  type PromoErrorCode,
  internalError,
} from "../../shared/errors.ts";
import { UsageService } from "./usage.service.ts";

// Motivos con los que `apply_promo_code` rechaza un código (RAISE EXCEPTION).
// La llave es el texto exacto que lanza la función SQL.
const PROMO_ERRORS: Record<string, { code: PromoErrorCode; message: string }> = {
  promo_not_found: { code: "PROMO_INVALID", message: "Código promocional inválido o inactivo." },
  promo_expired: { code: "PROMO_EXPIRED", message: "El código promocional ha expirado." },
  promo_max_uses_reached: { code: "PROMO_EXHAUSTED", message: "El código promocional ya alcanzó su límite de usos." },
  promo_already_used: { code: "PROMO_ALREADY_USED", message: "Ya aplicaste un código promocional en tu cuenta." },
  promo_not_applicable: {
    code: "PROMO_NOT_APPLICABLE",
    message: "Tu suscripción ya está activa; el código promocional no aplica.",
  },
};

/**
 * Un trial cuya fecha ya pasó está vencido aunque la columna siga en 'trial'.
 * El vencimiento se calcula, no se escribe: desde 2026-11-20 el asesor no puede
 * escribir columnas de suscripción con su JWT (migración billing_rls_hardening),
 * y así tampoco hace falta un cron que las actualice.
 */
function effectiveStatus(status: string, trialEndsAt: string | null): string {
  if (status === "trial" && trialEndsAt && new Date(trialEndsAt) < new Date()) return "expired";
  return status;
}

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
      status: effectiveStatus(agentInfo.subscriptionStatus, agentInfo.trialEndsAt) as SubscriptionInfo["status"],
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

  /**
   * Lee el estado del asesor y, con `requireActive`, exige suscripción vigente.
   * Devuelve el estado ya leído para que el caller lo reutilice sin otra query.
   * `requireActive = false` es para las rutas que deben funcionar con la
   * suscripción vencida (ver SUBSCRIPTION_EXEMPT_ROUTES en el DI).
   */
  async checkSubscriptionActive(agentId: string, requireActive = true): Promise<AgentStatusInfo> {
    const status = await this.repository.getAgentStatus(agentId);
    if (!status) throw new NotFoundError("Agente no encontrado.");
    if (!requireActive) return status;

    if (status.subscriptionStatus === "expired" || status.subscriptionStatus === "cancelled") {
      throw new PaymentRequiredError();
    }

    if (effectiveStatus(status.subscriptionStatus, status.trialEndsAt) === "expired") {
      throw new PaymentRequiredError("Tu período de prueba ha terminado. Activa un plan para continuar.");
    }

    return status;
  }

  async getPlans(): Promise<SubscriptionPlan[]> {
    return await this.repository.getActivePlans();
  }

  async applyPromoCode(agentId: string, code: string): Promise<{ trialEndsAt: string }> {
    const { data, error } = await this.repository.applyPromoCode(agentId, code);
    if (error) {
      const known = Object.hasOwn(PROMO_ERRORS, error.message) ? PROMO_ERRORS[error.message] : undefined;
      if (known) throw new PromoCodeError(known.message, known.code);
      throw internalError("No se pudo aplicar el código promocional.", `applyPromoCode failed: ${error.message}`);
    }
    return { trialEndsAt: data!.trial_ends_at };
  }
}
