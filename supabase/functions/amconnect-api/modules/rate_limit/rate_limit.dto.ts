import type { RateLimitBucket } from "../../shared/security.config.ts";

export type { RateLimitBucket };

/** Lo que responde `consume_rate_limit` (ya en camelCase). */
export interface RateLimitDecision {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
}

export interface RateLimitRule {
  limit: number;
  windowSeconds: number;
}
