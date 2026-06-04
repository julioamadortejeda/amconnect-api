import { Context } from "hono";
import { AppError } from "../../shared/errors.ts";
import { ZodError } from "zod";

export const globalErrorHandler = (err: Error, c: Context) => {
  if (err instanceof AppError) {
    return c.json({ success: false, error: err.message }, err.statusCode as never);
  }

  if (err instanceof ZodError) {
    return c.json(
      { success: false, error: "Datos de entrada inválidos.", details: err.flatten() },
      422,
    );
  }

  // deno-lint-ignore no-explicit-any
  if ((err as any)?.status === 429) {
    return c.json({ success: false, error: "Límite de solicitudes al modelo de IA alcanzado. Intenta de nuevo en unos segundos." }, 429);
  }

  console.error("[Unhandled Error]:", err);
  return c.json({ success: false, error: "Error interno del servidor." }, 500);
};
