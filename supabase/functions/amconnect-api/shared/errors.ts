import { PostgrestError } from "@supabase/supabase-js";

export class AppError extends Error {
  /**
   * Detalle técnico (tabla, código de Postgres, contexto interno) que se
   * persiste en error_logs pero NUNCA viaja al cliente. `message` es lo que
   * ve el usuario — debe ser limpio y sin internals.
   */
  public internal?: string;

  constructor(message: string, public statusCode = 500, public errorCode?: string) {
    super(message);
    this.name = "AppError";
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Recurso no encontrado.") {
    super(message, 404, "RESOURCE_NOT_FOUND");
    this.name = "NotFoundError";
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "No autorizado.") {
    super(message, 401, "SESSION_EXPIRED");
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Acceso denegado.") {
    super(message, 403, "ACCESS_DENIED");
    this.name = "ForbiddenError";
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 422, "VALIDATION_FAILED");
    this.name = "ValidationError";
  }
}

export class PaymentRequiredError extends AppError {
  constructor(message = "Tu suscripción ha vencido. Activa un plan para continuar.") {
    super(message, 402, "SUBSCRIPTION_REQUIRED");
    this.name = "PaymentRequiredError";
  }
}

export class QuotaExceededError extends AppError {
  constructor(message: string) {
    super(message, 429, "QUOTA_EXCEEDED");
    this.name = "QuotaExceededError";
  }
}

export class AiError extends AppError {
  constructor(message: string) {
    super(message, 502, "AI_ERROR");
    this.name = "AiError";
  }
}

/**
 * Thrown when the AI provider itself returns an error (503 high demand, 500 server error).
 * Unlike AiError (logic/model errors), this is NOT the user's fault.
 * Controllers catch this to mark sessions as non-billable and decrement monthly usage.
 */
export class AiProviderError extends AppError {
  constructor(message: string) {
    super(message, 503, "AI_PROVIDER_BUSY");
    this.name = "AiProviderError";
  }
}

/**
 * Thrown by ingestion services when an error occurs AFTER the AI provider
 * has already been invoked (tokens consumed). The controller uses this to
 * call markSessionFailed instead of deleteSession.
 */
export class AiInvokedError extends AppError {
  constructor(message: string, public override readonly cause?: Error) {
    super(message, 500, "AI_INVOCATION_FAILED");
    this.name = "AiInvokedError";
  }
}

export class ConflictError extends AppError {
  constructor(message = "Ya existe un registro con esos datos.") {
    super(message, 409, "RESOURCE_CONFLICT");
    this.name = "ConflictError";
  }
}

/**
 * Código promocional rechazado por `apply_promo_code`. Cada motivo lleva su
 * propio errorCode para que la app distinga "expirado" de "ya lo usaste" sin
 * leer el mensaje en español (RULES §2).
 */
export type PromoErrorCode =
  | "PROMO_INVALID"
  | "PROMO_EXPIRED"
  | "PROMO_EXHAUSTED"
  | "PROMO_ALREADY_USED"
  | "PROMO_NOT_APPLICABLE";

export class PromoCodeError extends AppError {
  constructor(message: string, errorCode: PromoErrorCode) {
    super(message, 400, errorCode);
    this.name = "PromoCodeError";
  }
}

/**
 * Crea un AppError con mensaje público limpio y detalle técnico separado.
 * Usar en lugar de interpolar `error.message` de Supabase/SDKs en el mensaje.
 */
export function internalError(
  publicMessage: string,
  internal: string,
  statusCode = 500,
  errorCode?: string,
): AppError {
  const err = new AppError(publicMessage, statusCode, errorCode);
  err.internal = internal;
  return err;
}

// Códigos de Postgres que indican datos inválidos enviados por el cliente (422).
const VALIDATION_PG_CODES = new Set(["22007", "23502", "23514"]);

/**
 * Convierte un error de Supabase en un AppError con mensaje PÚBLICO limpio.
 * El `context` (que suele incluir el nombre de la tabla) y el detalle de
 * Postgres van en `internal` — se loguean en error_logs, nunca al cliente.
 */
export function handleSupabaseError(error: PostgrestError, context: string): never {
  const internal = `${context} (${error.code}: ${error.message})`;

  let err: AppError;
  // PGRST116 = no rows found → 404
  if (error.code === "PGRST116") err = new NotFoundError();
  // 22P02 = invalid UUID / type syntax
  else if (error.code === "22P02") err = new ValidationError("El identificador proporcionado no es válido.");
  // 23503 = FK violation → el registro referenciado no existe
  else if (error.code === "23503") err = new ValidationError("Referencia inválida: el registro relacionado no existe.");
  // 23505 = unique constraint → duplicado
  else if (error.code === "23505") err = new ConflictError();
  // 22007 = fecha inválida, 23502 = NOT NULL, 23514 = CHECK → dato del cliente mal formado.
  // Mensaje genérico: el nombre de columna/constraint va solo en `internal`.
  else if (VALIDATION_PG_CODES.has(error.code)) err = new ValidationError("Algún dato enviado no es válido.");
  else err = new AppError("Ocurrió un error al procesar la solicitud.", 500);

  err.internal = internal;
  throw err;
}
