import { AiSessionService } from "../features/ai_chat/ai_session.service.ts";
import { AiInvokedError, AiProviderError } from "./errors.ts";
import { UsageService } from "../modules/subscription/usage.service.ts";

/**
 * Compensación cuando una ingesta (póliza, archivo o texto) falla, según el
 * tipo de error:
 * - AiProviderError: el provider falló (no es culpa del usuario) → marcar sesión y devolver la cuota
 * - AiInvokedError: el AI ya consumió tokens → marcar sesión fallida, la cuota se queda consumida
 * - Cualquier otro: nada llegó al AI → borrar la sesión y devolver la cuota
 *
 * Compartida por los tres flujos de ingesta (RULES §6: lógica repetida en 2+
 * lugares → extraer a shared/) — antes vivía duplicada en AiController.
 */
export async function compensateIngestionFailure(
  err: unknown,
  aiSessionService: AiSessionService,
  usageService: UsageService,
  agentId: string,
  sessionId: string,
  chargedIngestion: boolean = true,
): Promise<void> {
  if (err instanceof AiProviderError) {
    await Promise.all([
      aiSessionService.markSessionProviderError(sessionId, err instanceof Error ? err.message : ""),
      chargedIngestion ? usageService.decrementIngestion(agentId) : Promise.resolve(),
    ]);
  } else if (err instanceof AiInvokedError) {
    await aiSessionService.markSessionFailed(sessionId, err.message);
  } else {
    await Promise.all([
      aiSessionService.deleteSession(sessionId),
      chargedIngestion ? usageService.decrementIngestion(agentId) : Promise.resolve(),
    ]);
  }
}
