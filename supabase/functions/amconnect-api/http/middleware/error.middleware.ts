import { Context } from "hono";
import { AppError } from "../../shared/errors.ts";
import { ErrorLogRepository } from "../../modules/error_log/error_log.repository.ts";
import { ErrorLogService } from "../../modules/error_log/error_log.service.ts";
import { ZodError } from "zod";

// Códigos que NO se persisten: ruido sin valor de diagnóstico
// (401 = tokens expirados, ocurre constantemente y ya lo maneja la app).
const SKIP_PERSIST_STATUS = new Set([401]);

// Garantiza que toda respuesta de error lleve un errorCode estable aunque
// el throw original haya sido un AppError "pelón" sin código.
function fallbackCodeFor(status: number): string {
  switch (status) {
    case 400:
    case 422:
      return "VALIDATION_FAILED";
    case 401:
      return "SESSION_EXPIRED";
    case 402:
      return "SUBSCRIPTION_REQUIRED";
    case 403:
      return "ACCESS_DENIED";
    case 404:
      return "RESOURCE_NOT_FOUND";
    case 409:
      return "RESOURCE_CONFLICT";
    case 429:
      return "QUOTA_EXCEEDED";
    default:
      return "INTERNAL_ERROR";
  }
}

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
    metadata: {
      severity: statusCode >= 500 ? "server" : "client",
      ...(extra ?? {}),
    },
  });
}

export const globalErrorHandler = async (err: Error, c: Context) => {
  // Errores de aplicación controlados — se persisten TODOS (4xx incluidos,
  // salvo SKIP_PERSIST_STATUS) para poder diagnosticar problemas de usuarios
  // en beta: cuotas alcanzadas, validaciones fallidas, conflictos, etc.
  if (err instanceof AppError) {
    const errorCode = err.errorCode ?? fallbackCodeFor(err.statusCode);

    let errorId: string | null = null;
    if (!SKIP_PERSIST_STATUS.has(err.statusCode)) {
      // error_message guarda el detalle técnico (err.internal: tabla, código
      // de Postgres, contexto) cuando existe — es lo útil para diagnosticar.
      // El mensaje público queda en metadata por si hace falta correlacionar.
      errorId = await persistError(c, err.name, err.statusCode, err.internal ?? err.message, err.stack, {
        errorCode,
        ...(err.internal ? { publicMessage: err.message } : {}),
      });
      if (!errorId && err.statusCode >= 500) console.error(`[${err.name}]`, err.internal ?? err.message, err.stack);
    }

    return c.json(
      { success: false, error: err.message, errorCode, errorId },
      err.statusCode as never,
    );
  }

  // Errores de validación Zod — cliente; se devuelven con detalle y no se persisten
  // (el detalle campo-a-campo ya le dice a la app qué corregir).
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
      errorCode: "AI_PROVIDER_BUSY",
      // deno-lint-ignore no-explicit-any
      rawMessage: (err as any)?.message,
    });
    if (!errorId) console.error("[AiRateLimitError raw SDK]", err);

    return c.json({ success: false, error: msg, errorCode: "AI_PROVIDER_BUSY", errorId }, 429);
  }

  // Error no controlado
  const errorId = await persistError(c, err.name || "UnhandledError", 500, err.message, err.stack);
  if (!errorId) console.error("[UnhandledError]", err);

  return c.json({ success: false, error: "Error interno del servidor.", errorCode: "INTERNAL_ERROR", errorId }, 500);
};
