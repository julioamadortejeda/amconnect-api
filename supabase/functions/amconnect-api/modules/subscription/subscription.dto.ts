import { z } from "zod";

export interface PlanLimits {
  chat_messages_monthly: number;
  ingestions_monthly: number;
  storage_mb: number;
}

export interface SubscriptionPlan {
  id: string;
  slug: string;
  name: string;
  priceMxn: number;
  priceUsd: number;
  limits: PlanLimits;
}

export interface UsageThisMonth {
  chatMessages: number;
  ingestions: number;
}

export interface SubscriptionInfo {
  plan: SubscriptionPlan;
  status: "trial" | "active" | "expired" | "cancelled";
  trialEndsAt: string | null;
  subscriptionExpiresAt: string | null;
  trialDaysRemaining: number | null;
  usage: UsageThisMonth;
}

export const ApplyPromoSchema = z.object({
  code: z.string().min(1),
});
