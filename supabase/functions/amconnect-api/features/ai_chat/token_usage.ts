// Suma de uso de tokens de un turno (clasificador + llamadas al modelo).
import type { TokenUsage } from "../../core/ai_provider.interface.ts";
import type { UsageTokens } from "./ai_session.service.ts";

export function emptyUsage(): UsageTokens {
  return { promptTokens: 0, completionTokens: 0, totalTokens: 0, cachedTokens: 0, thoughtsTokens: 0 };
}

/** Suma `usage` (si hay) a `target` y lo devuelve. */
export function addUsage(target: UsageTokens, usage?: TokenUsage): UsageTokens {
  if (!usage) return target;
  target.promptTokens += usage.promptTokens;
  target.completionTokens += usage.completionTokens;
  target.totalTokens += usage.totalTokens;
  target.cachedTokens = (target.cachedTokens ?? 0) + (usage.cachedTokens ?? 0);
  target.thoughtsTokens = (target.thoughtsTokens ?? 0) + (usage.thoughtsTokens ?? 0);
  return target;
}
