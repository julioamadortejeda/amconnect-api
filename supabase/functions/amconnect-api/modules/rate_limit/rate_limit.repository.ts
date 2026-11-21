import { SupabaseClient } from "@supabase/supabase-js";
import { internalError } from "../../shared/errors.ts";
import type { RateLimitBucket, RateLimitDecision, RateLimitRule } from "./rate_limit.dto.ts";

export interface IRateLimitRepository {
  consume(bucket: RateLimitBucket, rule: RateLimitRule): Promise<RateLimitDecision>;
}

// RPC a propósito (excepción a "no usar RPCs para lo que se resuelve en TS"):
// contar y decidir tiene que ser atómico entre isolates; un read-then-update
// desde TS dejaría pasar peticiones simultáneas. El asesor lo pone la BD desde
// auth.uid() del JWT con que viene el cliente — no se manda.
export class RateLimitRepository implements IRateLimitRepository {
  constructor(private supabase: SupabaseClient) {}

  async consume(bucket: RateLimitBucket, rule: RateLimitRule): Promise<RateLimitDecision> {
    const { data, error } = await this.supabase.rpc("consume_rate_limit", {
      p_bucket: bucket,
      p_limit: rule.limit,
      p_window_seconds: rule.windowSeconds,
    });
    if (error) {
      throw internalError(
        "Ocurrió un error al procesar la solicitud.",
        `consume_rate_limit failed (${error.code}: ${error.message})`,
      );
    }
    const row = data as { allowed?: unknown; remaining?: unknown; retryAfterSeconds?: unknown } | null;
    if (!row || typeof row.allowed !== "boolean") {
      throw internalError("Ocurrió un error al procesar la solicitud.", "consume_rate_limit returned an unexpected shape");
    }
    return {
      allowed: row.allowed,
      remaining: Number(row.remaining ?? 0),
      retryAfterSeconds: Number(row.retryAfterSeconds ?? 0),
    };
  }
}
