// Repos falsos y constructores de datos de prueba.
//
// Los fakes implementan la interfaz del repo (`IUsageRepository`, ...) para que
// el compilador avise si el contrato cambia. Cada uno guarda lo que recibió
// para que la prueba verifique efectos, no solo valores devueltos.
import type {
  IncrementResult,
  IUsageRepository,
  MonthlyUsageRow,
  TokenUsageParams,
} from "../../modules/subscription/usage.repository.ts";
import type {
  AgentPlanInfo,
  AgentStatusInfo,
  ApplyPromoResult,
  ISubscriptionRepository,
  SubscriptionPlanRow,
} from "../../modules/subscription/subscription.repository.ts";

const DAY_MS = 24 * 60 * 60 * 1000;

/** Fecha ISO a `days` días de hoy (negativo = en el pasado). */
export function daysFromNow(days: number): string {
  return new Date(Date.now() + days * DAY_MS).toISOString();
}

// ─── Usage ──────────────────────────────────────────────────────────────────

export class FakeUsageRepository implements IUsageRepository {
  monthlyUsage: MonthlyUsageRow | null = null;
  chatLimit = 100;
  incrementResult: IncrementResult = {
    data: { charge_id: "charge-1", chat_count: 1, ingestion_count: 0 },
    error: null,
  };

  readonly increments: Array<{ agentId: string; field: "chat" | "ingestion" }> = [];
  readonly refunds: string[] = [];
  readonly monthlyQueries: Array<{ agentId: string; yearMonth: string }> = [];
  readonly tokenLogs: TokenUsageParams[] = [];

  getMonthlyUsage(agentId: string, yearMonth: string): Promise<MonthlyUsageRow | null> {
    this.monthlyQueries.push({ agentId, yearMonth });
    return Promise.resolve(this.monthlyUsage);
  }
  incrementUsage(agentId: string, field: "chat" | "ingestion"): Promise<IncrementResult> {
    this.increments.push({ agentId, field });
    return Promise.resolve(this.incrementResult);
  }
  refundCharge(chargeId: string): Promise<void> {
    this.refunds.push(chargeId);
    return Promise.resolve();
  }
  getChatLimit(_agentId: string): Promise<number> {
    return Promise.resolve(this.chatLimit);
  }
  logTokenUsage(params: TokenUsageParams): Promise<void> {
    this.tokenLogs.push(params);
    return Promise.resolve();
  }
}

// ─── Subscription ───────────────────────────────────────────────────────────

export function buildPlan(overrides: Partial<SubscriptionPlanRow> = {}): SubscriptionPlanRow {
  return {
    id: "plan-1",
    slug: "consolidado",
    name: "Consolidado",
    priceMxn: 299,
    priceUsd: 15,
    limits: { chat_messages_monthly: 500, ingestions_monthly: 50, storage_mb: 1024 },
    ...overrides,
  };
}

export function buildAgentStatus(overrides: Partial<AgentStatusInfo> = {}): AgentStatusInfo {
  return {
    subscriptionStatus: "trial",
    trialEndsAt: daysFromNow(7),
    timezone: "America/Mexico_City",
    locale: "es",
    ...overrides,
  };
}

export class FakeSubscriptionRepository implements ISubscriptionRepository {
  agentStatus: AgentStatusInfo | null = buildAgentStatus();
  agentPlan: AgentPlanInfo | null = null;
  plans: SubscriptionPlanRow[] = [buildPlan()];
  promoResult: ApplyPromoResult = { data: { trial_ends_at: daysFromNow(30) }, error: null };
  readonly promoCalls: Array<{ agentId: string; code: string }> = [];

  getAgentWithPlan(_agentId: string): Promise<AgentPlanInfo | null> {
    return Promise.resolve(this.agentPlan);
  }
  getAgentStatus(_agentId: string): Promise<AgentStatusInfo | null> {
    return Promise.resolve(this.agentStatus);
  }
  getActivePlans(): Promise<SubscriptionPlanRow[]> {
    return Promise.resolve(this.plans);
  }
  applyPromoCode(agentId: string, code: string): Promise<ApplyPromoResult> {
    this.promoCalls.push({ agentId, code });
    return Promise.resolve(this.promoResult);
  }
}

/** Ejecuta `fn` y devuelve lo que lanzó; falla si no lanzó nada. */
export async function captureError<E = unknown>(fn: () => unknown): Promise<E> {
  try {
    await fn();
  } catch (e) {
    return e as E;
  }
  throw new Error("se esperaba que lanzara y no lanzó");
}
