import type { Context } from "hono";
import { zValidator } from "@hono/zod-validator";
import type { ZodTypeAny, z } from "zod";

type Target = "query" | "param";

/**
 * Valida `query` o `param` con Zod. Si falla, relanza el `ZodError` para que
 * `globalErrorHandler` responda 422 `VALIDATION_FAILED` con el mismo formato
 * que el body (el 400 por defecto de zValidator no cumple el contrato de
 * errores). Se monta en la ruta; el controller lee el resultado con `validated`.
 */
export function validate<S extends ZodTypeAny>(target: Target, schema: S) {
  return zValidator(target, schema, (result) => {
    if (!result.success) throw result.error;
  });
}

/** Lo que `validate` ya parseó (con defaults y coerciones aplicados). */
export function validated<S extends ZodTypeAny>(c: Context, target: Target, _schema?: S): z.output<S> {
  // `Context` sin genéricos no conoce los targets que la ruta validó.
  return c.req.valid(target as never) as z.output<S>;
}
