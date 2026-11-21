import { Context, Next } from "hono";
import type { SupabaseClient } from "@supabase/supabase-js";
import { RateLimitRepository } from "../../modules/rate_limit/rate_limit.repository.ts";
import { RateLimitService } from "../../modules/rate_limit/rate_limit.service.ts";

/**
 * Límite por minuto por asesor (D-027). Va DESPUÉS de authMiddleware (necesita
 * el cliente con el JWT del asesor) y ANTES del DI, para que una petición
 * rechazada no pague las consultas del contenedor. Los números viven en
 * shared/security.config.ts. /health, /openapi.json y el cron se montan antes
 * de auth en index.ts, así que nunca llegan aquí.
 */
export const rateLimitMiddleware = async (c: Context, next: Next) => {
  const supabase: SupabaseClient = c.get("supabase");
  const service = new RateLimitService(new RateLimitRepository(supabase));
  // El router está montado en /amconnect-api; la config se escribe sin prefijo.
  const path = c.req.path.replace(/^\/amconnect-api/, "");
  await service.enforce(c.req.method, path);
  await next();
};
