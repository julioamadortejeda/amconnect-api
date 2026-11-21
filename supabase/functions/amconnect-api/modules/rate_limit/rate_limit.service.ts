import { AI_ROUTES_IN_GENERAL_BUCKET, RATE_LIMITS } from "../../shared/security.config.ts";
import { RateLimitedError } from "../../shared/errors.ts";
import type { RateLimitBucket } from "./rate_limit.dto.ts";
import type { IRateLimitRepository } from "./rate_limit.repository.ts";

/**
 * Qué cupo gasta una petición. `path` va SIN el prefijo /amconnect-api.
 * `/ai/*` → `ai` (salvo la plomería de voz listada en la config); lo demás → `general`.
 */
export function bucketFor(method: string, path: string): RateLimitBucket {
  const isAi = path === "/ai" || path.startsWith("/ai/");
  if (!isAi) return "general";
  return AI_ROUTES_IN_GENERAL_BUCKET.has(`${method.toUpperCase()} ${path}`) ? "general" : "ai";
}

export class RateLimitService {
  constructor(
    private repository: IRateLimitRepository,
    private rules = RATE_LIMITS,
  ) {}

  /**
   * Cuenta la petición y lanza `RateLimitedError` (429) si el asesor se pasó.
   * Si el contador falla, deja pasar (fail-open) y lo registra: ver la razón en
   * shared/security.config.ts.
   */
  async enforce(method: string, path: string): Promise<void> {
    const bucket = bucketFor(method, path);
    let decision;
    try {
      decision = await this.repository.consume(bucket, this.rules[bucket]);
    } catch (error) {
      const detail = (error as { internal?: string; message?: string })?.internal ??
        (error as Error)?.message ?? String(error);
      console.error(`[RATE_LIMIT] limiter unavailable, failing open (bucket=${bucket}):`, detail);
      return;
    }
    if (!decision.allowed) throw new RateLimitedError(decision.retryAfterSeconds);
  }
}
