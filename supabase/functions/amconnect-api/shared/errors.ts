import { PostgrestError } from "@supabase/supabase-js";

export class AppError extends Error {
  constructor(message: string, public statusCode = 500) {
    super(message);
    this.name = "AppError";
  }
}

export class NotFoundError extends AppError {
  constructor(message = "Recurso no encontrado.") {
    super(message, 404);
    this.name = "NotFoundError";
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = "No autorizado.") {
    super(message, 401);
    this.name = "UnauthorizedError";
  }
}

export class ForbiddenError extends AppError {
  constructor(message = "Acceso denegado.") {
    super(message, 403);
    this.name = "ForbiddenError";
  }
}

export class ValidationError extends AppError {
  constructor(message: string) {
    super(message, 422);
    this.name = "ValidationError";
  }
}

export class AiError extends AppError {
  constructor(message: string) {
    super(message, 502);
    this.name = "AiError";
  }
}

export class ConflictError extends AppError {
  constructor(message = "Ya existe un registro con esos datos.") {
    super(message, 409);
    this.name = "ConflictError";
  }
}

export function handleSupabaseError(error: PostgrestError, message: string): never {
  // PGRST116 = no rows found → 404
  if (error.code === "PGRST116") throw new NotFoundError(message);
  // 22P02 = invalid UUID / type syntax
  if (error.code === "22P02") throw new ValidationError("El identificador proporcionado no es válido.");
  // 23503 = FK violation → el registro referenciado no existe
  if (error.code === "23503") throw new ValidationError("Referencia inválida: el registro relacionado no existe.");
  // 23505 = unique constraint → duplicado
  if (error.code === "23505") throw new ConflictError();
  throw new AppError(`${message} (${error.code}: ${error.message})`, 500);
}
