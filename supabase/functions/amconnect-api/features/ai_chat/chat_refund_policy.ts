// Cuándo se devuelve el mensaje de chat cobrado. Lo comparten el endpoint JSON
// (`POST /ai/chat`) y el SSE (`POST /ai/chat/stream`): las reglas son las mismas.
import { AiProviderError, AppError, ConflictError, NotFoundError } from "../../shared/errors.ts";

/**
 * El asesor no recibió respuesta por algo que no es su culpa: falla del
 * proveedor, error crudo no controlado (red/timeout) o sesión inexistente/
 * ajena o con otro turno en curso, 409 (ambas rechazadas antes del modelo).
 * AiError ("respuesta inutilizable" de Gemini) y demás AppError NO reembolsan
 * (decisión del usuario).
 */
export function isRefundableChatError(err: unknown): boolean {
  return err instanceof AiProviderError ||
    err instanceof NotFoundError ||
    err instanceof ConflictError ||
    !(err instanceof AppError);
}

/**
 * Turno cancelado (§7.3): lo que Gemini ya procesó se cobra (Google ya lo
 * factura); si se canceló antes de la primera llamada al modelo, se devuelve.
 */
export function isRefundableCancel(modelCalls: number): boolean {
  return modelCalls === 0;
}
