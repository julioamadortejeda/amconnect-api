import { Context } from "hono";
import { AppError, RateLimitedError } from "../../shared/errors.ts";
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

// Distingue el SyntaxError del parseo del body del request de cualquier otro
// (p. ej. JSON.parse de una respuesta del modelo, que SÍ es un fallo nuestro):
// el primero nace dentro de hono (dist/request.js).
function isRequestBodyParseError(err: Error): boolean {
  return /hono[^\n]*[\\/]request\.(js|ts)/.test(err.stack ?? "");
}

/** Respuesta de error ya resuelta: status, sobre `{ success:false, error, errorCode, errorId? }` y headers. */
export interface ErrorResponse {
  status: number;
  body: { success: false; error: string; errorCode: string; errorId?: string | null; details?: unknown };
  headers?: Record<string, string>;
}

// Traduce cualquier error al sobre del contrato (y lo persiste en error_logs
// cuando aplica). Lo usan el globalErrorHandler (JSON) y el endpoint SSE, que
// ya no puede cambiar el status una vez abierto el stream y manda lo mismo
// como evento `error`.
export async function resolveErrorResponse(err: Error, c: Context): Promise<ErrorResponse> {
  // Errores de aplicación controlados — se persisten TODOS (4xx incluidos,
  // salvo SKIP_PERSIST_STATUS) para poder diagnosticar problemas de usuarios
  // en beta: cuotas alcanzadas, validaciones fallidas, conflictos, etc.
  if (err instanceof AppError) {
    const errorCode = err.errorCode ?? fallbackCodeFor(err.statusCode);

    // 429 del límite por minuto: NO se persiste. Un cliente en bucle generaría
    // un insert en error_logs por cada rechazo — justo la carga que el límite
    // quiere frenar.
    if (err instanceof RateLimitedError) {
      return {
        status: 429,
        body: { success: false, error: err.message, errorCode },
        headers: { "Retry-After": String(Math.max(1, Math.ceil(err.retryAfterSeconds))) },
      };
    }

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

    return { status: err.statusCode, body: { success: false, error: err.message, errorCode, errorId } };
  }

  // Errores de validación Zod — cliente; se devuelven con detalle y no se persisten
  // (el detalle campo-a-campo ya le dice a la app qué corregir).
  if (err instanceof ZodError) {
    return {
      status: 422,
      body: { success: false, error: "Datos de entrada inválidos.", errorCode: "VALIDATION_FAILED", details: (err as ZodError).flatten() },
    };
  }

  // Body JSON malformado (`c.req.json()` lanza SyntaxError): es culpa del
  // cliente, no un fallo del servidor. Aplica a toda ruta que parsee el body.
  if (err instanceof SyntaxError && isRequestBodyParseError(err)) {
    return {
      status: 422,
      body: { success: false, error: "El cuerpo de la solicitud no es un JSON válido.", errorCode: "VALIDATION_FAILED" },
    };
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

    return { status: 429, body: { success: false, error: msg, errorCode: "AI_PROVIDER_BUSY", errorId } };
  }

  // Error no controlado
  const errorId = await persistError(c, err.name || "UnhandledError", 500, err.message, err.stack);
  if (!errorId) console.error("[UnhandledError]", err);

  return { status: 500, body: { success: false, error: "Error interno del servidor.", errorCode: "INTERNAL_ERROR", errorId } };
}

export const globalErrorHandler = async (err: Error, c: Context) => {
  const { status, body, headers } = await resolveErrorResponse(err, c);
  for (const [name, value] of Object.entries(headers ?? {})) c.header(name, value);
  return c.json(body, status as never);
};
