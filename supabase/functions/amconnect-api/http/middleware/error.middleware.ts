import { Context } from "hono";
import { AppError } from "../../shared/errors.ts";
import { ErrorLogRepository } from "../../modules/error_log/error_log.repository.ts";
import { ErrorLogService } from "../../modules/error_log/error_log.service.ts";
import { ZodError } from "zod";

// Errores de cliente esperados — no se persisten, se devuelven directo
const CLIENT_ERROR_CODES = new Set([400, 401, 402, 403, 404, 409, 422, 429]);

async function persistError(
  c: Context,
  errorType: string,
  statusCode: number,
  message: string,
  stack?: string,
  extra?: Record<string, unknown>,
): Promise<string | null> {
  const supabase = c.get("supabase");
  if (!supabase) return null;

  const service = new ErrorLogService(new ErrorLogRepository(supabase));
  const req = c.req;

  return await service.log({
    agentId: c.get("agent_id") ?? null,
    errorType,
    statusCode,
    errorMessage: message,
    stackTrace: stack ?? null,
    requestPath: new URL(req.url).pathname,
    requestMethod: req.method,
    metadata: extra ?? null,
  });
}

export const globalErrorHandler = async (err: Error, c: Context) => {
  // Errores de aplicación controlados
  if (err instanceof AppError) {
    if (CLIENT_ERROR_CODES.has(err.statusCode)) {
      return c.json({ success: false, error: err.message, errorCode: err.errorCode }, err.statusCode as never);
    }

    const errorId = await persistError(c, err.name, err.statusCode, err.message, err.stack);
    if (!errorId) console.error(`[${err.name}]`, err.message, err.stack);

    return c.json(
      { success: false, error: err.message, errorCode: err.errorCode, errorId },
      err.statusCode as never,
    );
  }

  // Errores de validación Zod — cliente, no se persisten
  if (err instanceof ZodError) {
    return c.json(
      { success: false, error: "Datos de entrada inválidos.", errorCode: "VALIDATION_FAILED", details: (err as ZodError).flatten() },
      422,
    );
  }

  // Rate limit crudo del SDK (por si algún provider no wrappea el error)
  // deno-lint-ignore no-explicit-any
  if ((err as any)?.status === 429) {
    const msg = "Límite de solicitudes al modelo de IA alcanzado. Intenta de nuevo en unos segundos.";
    const errorId = await persistError(c, "AiRateLimitError", 429, msg, err.stack, {
      // deno-lint-ignore no-explicit-any
      rawMessage: (err as any)?.message,
    });
    if (!errorId) console.error("[AiRateLimitError raw SDK]", err);

    return c.json({ success: false, error: msg, errorId }, 429);
  }

  // Error no controlado
  const errorId = await persistError(c, err.name || "UnhandledError", 500, err.message, err.stack);
  if (!errorId) console.error("[UnhandledError]", err);

  return c.json({ success: false, error: "Error interno del servidor.", errorId }, 500);
};
