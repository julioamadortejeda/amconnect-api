import { SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "../../shared/errors.ts";
import type { PlanLimits } from "./subscription.dto.ts";

export interface AgentPlanInfo {
  subscriptionStatus: string;
  trialEndsAt: string | null;
  subscriptionExpiresAt: string | null;
  plan: {
    id: string;
    slug: string;
    name: string;
    priceMxn: number;
    priceUsd: number;
    limits: PlanLimits;
  };
}

export interface AgentStatusInfo {
  subscriptionStatus: string;
  trialEndsAt: string | null;
}

export interface SubscriptionPlanRow {
  id: string;
  slug: string;
  name: string;
  priceMxn: number;
  priceUsd: number;
  limits: PlanLimits;
}

export interface ApplyPromoResult {
  data: { trial_ends_at: string } | null;
  error: { message: string } | null;
}

export interface ISubscriptionRepository {
  getAgentWithPlan(agentId: string): Promise<AgentPlanInfo | null>;
  getAgentStatus(agentId: string): Promise<AgentStatusInfo | null>;
  expireAgent(agentId: string): Promise<void>;
  getActivePlans(): Promise<SubscriptionPlanRow[]>;
  applyPromoCode(agentId: string, code: string): Promise<ApplyPromoResult>;
}

export class SubscriptionRepository implements ISubscriptionRepository {
  constructor(private supabase: SupabaseClient) {}

  async getAgentWithPlan(agentId: string): Promise<AgentPlanInfo | null> {
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
    return {
      subscriptionStatus: agent.subscription_status,
      trialEndsAt: agent.trial_ends_at ?? null,
      subscriptionExpiresAt: agent.subscription_expires_at ?? null,
      plan: {
        id: plan.id,
        slug: plan.slug,
        name: plan.name,
        priceMxn: plan.price_mxn,
        priceUsd: plan.price_usd,
        limits: plan.limits as PlanLimits,
      },
    };
  }

  async getAgentStatus(agentId: string): Promise<AgentStatusInfo | null> {
    const { data: agent, error } = await this.supabase
      .from("agents")
      .select("subscription_status, trial_ends_at")
      .eq("id", agentId)
      .single();

    if (error || !agent) return null;
    return {
      subscriptionStatus: agent.subscription_status,
      trialEndsAt: agent.trial_ends_at ?? null,
    };
  }

  async expireAgent(agentId: string): Promise<void> {
    await this.supabase
      .from("agents")
      .update({ subscription_status: "expired" })
      .eq("id", agentId);
  }

  async getActivePlans(): Promise<SubscriptionPlanRow[]> {
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

  async applyPromoCode(agentId: string, code: string): Promise<ApplyPromoResult> {
    const { data, error } = await this.supabase.rpc("apply_promo_code", {
      p_agent_id: agentId,
      p_code: code,
    });
    return { data, error };
  }
}
