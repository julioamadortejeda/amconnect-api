import { SupabaseClient } from "@supabase/supabase-js";
import { PlanLimits, SubscriptionInfo, SubscriptionPlan, UsageThisMonth } from "./subscription.dto.ts";
import { AppError, PaymentRequiredError } from "../../shared/errors.ts";
import { UsageService } from "./usage.service.ts";

export class SubscriptionService {
  constructor(private supabase: SupabaseClient) {}

  async getSubscriptionInfo(agentId: string): Promise<SubscriptionInfo> {
    const { data: agent, error } = await this.supabase
      .from("agents")
      .select(`
        subscription_status,
        trial_ends_at,
        subscription_expires_at,
        plan:subscription_plans(id, slug, name, price_mxn, price_usd, limits)
      `)
      .eq("id", agentId)
      .single();

    if (error || !agent || !agent.plan) {
      throw new AppError("No se pudo obtener la información de suscripción.", 500);
    }

    const plan = Array.isArray(agent.plan) ? agent.plan[0] : agent.plan;
    const usage = await this.getCurrentUsage(agentId);

    let trialDaysRemaining: number | null = null;
    if (agent.subscription_status === "trial" && agent.trial_ends_at) {
      const msLeft = new Date(agent.trial_ends_at).getTime() - Date.now();
      trialDaysRemaining = Math.max(0, Math.ceil(msLeft / (1000 * 60 * 60 * 24)));
    }

    return {
      plan: {
        id: plan.id,
        slug: plan.slug,
        name: plan.name,
        priceMxn: plan.price_mxn,
        priceUsd: plan.price_usd,
        limits: plan.limits as PlanLimits,
      },
      status: agent.subscription_status,
      trialEndsAt: agent.trial_ends_at ?? null,
      subscriptionExpiresAt: agent.subscription_expires_at ?? null,
      trialDaysRemaining,
      usage,
    };
  }

  async getPlanLimits(agentId: string): Promise<PlanLimits> {
    const { data, error } = await this.supabase
      .from("agents")
      .select("plan:subscription_plans(limits)")
      .eq("id", agentId)
      .single();

    if (error || !data?.plan) throw new AppError("Plan no encontrado.", 500);
    const plan = Array.isArray(data.plan) ? data.plan[0] : data.plan;
    return plan.limits as PlanLimits;
  }

  async getPlanContext(agentId: string): Promise<{ limits: PlanLimits }> {
    const { data, error } = await this.supabase
      .from("agents")
      .select("plan:subscription_plans(limits)")
      .eq("id", agentId)
      .single();

    if (error || !data?.plan) throw new AppError("Plan no encontrado.", 500);
    const plan = Array.isArray(data.plan) ? data.plan[0] : data.plan;
    return { limits: plan.limits as PlanLimits };
  }

  async getCurrentUsage(agentId: string): Promise<UsageThisMonth> {
    const usage = await new UsageService(this.supabase).getMonthlyUsage(agentId);
    return {
      chatMessages: usage.chatCount,
      ingestions: usage.ingestionCount,
    };
  }

  async checkSubscriptionActive(agentId: string): Promise<void> {
    const { data: agent, error } = await this.supabase
      .from("agents")
      .select("subscription_status, trial_ends_at")
      .eq("id", agentId)
      .single();

    if (error || !agent) throw new AppError("Agente no encontrado.", 404);

    if (agent.subscription_status === "expired" || agent.subscription_status === "cancelled") {
      throw new PaymentRequiredError();
    }

    if (agent.subscription_status === "trial" && agent.trial_ends_at) {
      if (new Date(agent.trial_ends_at) < new Date()) {
        await this.supabase
          .from("agents")
          .update({ subscription_status: "expired" })
          .eq("id", agentId);
        throw new PaymentRequiredError("Tu período de prueba ha terminado. Activa un plan para continuar.");
      }
    }
  }

  async getPlans(): Promise<SubscriptionPlan[]> {
    const { data, error } = await this.supabase
      .from("subscription_plans")
      .select("id, slug, name, price_mxn, price_usd, limits")
      .eq("is_active", true)
      .order("price_mxn", { ascending: true });

    if (error) throw new AppError("No se pudieron obtener los planes.", 500);

    return (data ?? []).map((p) => ({
      id: p.id,
      slug: p.slug,
      name: p.name,
      priceMxn: p.price_mxn,
      priceUsd: p.price_usd,
      limits: p.limits as PlanLimits,
    }));
  }

  async applyPromoCode(agentId: string, code: string): Promise<{ trialEndsAt: string }> {
    const { data: promo, error } = await this.supabase
      .from("promo_codes")
      .select("*")
      .eq("code", code.toUpperCase())
      .eq("is_active", true)
      .single();

    if (error || !promo) throw new AppError("Código promocional inválido o inactivo.", 400);

    if (promo.expires_at && new Date(promo.expires_at) < new Date()) {
      throw new AppError("El código promocional ha expirado.", 400);
    }

    if (promo.max_uses !== null && promo.used_count >= promo.max_uses) {
      throw new AppError("El código promocional ya alcanzó su límite de usos.", 400);
    }

    const trialEndsAt = new Date(Date.now() + promo.trial_days * 24 * 60 * 60 * 1000).toISOString();

    await Promise.all([
      this.supabase
        .from("agents")
        .update({
          trial_ends_at: trialEndsAt,
          subscription_status: "trial",
          promo_code_used: code.toUpperCase(),
        })
        .eq("id", agentId),
      this.supabase
        .from("promo_codes")
        .update({ used_count: promo.used_count + 1 })
        .eq("id", promo.id),
    ]);

    return { trialEndsAt };
  }
}
