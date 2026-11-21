import type { Context } from "hono";
import { apiRouter } from "../routes/index.ts";
import { buildOpenApiDocument } from "../openapi/openapi.builder.ts";

let cached: Record<string, unknown> | undefined;

export class OpenApiController {
  /**
   * EXCEPCIÓN a "siempre sendSuccess" (RULES §1.1): el documento OpenAPI se
   * sirve CRUDO porque Swagger UI, Postman y los generadores de clientes
   * esperan el documento en la raíz del JSON, no dentro de `data`.
   */
  static getDocument(c: Context) {
    cached ??= buildOpenApiDocument(apiRouter);
    return c.json(cached);
  }
}
