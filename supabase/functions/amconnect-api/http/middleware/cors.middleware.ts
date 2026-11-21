import { Context, Next } from "hono";
import { cors } from "hono/cors";
import { CORS_ALLOWED_ORIGINS } from "../../shared/security.config.ts";

// CORS cerrado (D-027): solo los orígenes de shared/security.config.ts (hoy
// ninguno). A un origen fuera de la lista no se le manda
// Access-Control-Allow-Origin —tampoco en el preflight— y el navegador bloquea.
// La app móvil no manda Origin ni hace preflight, así que no le afecta.
export function createCorsMiddleware(allowed: readonly string[] = CORS_ALLOWED_ORIGINS) {
  const handler = cors({
    origin: (origin) => (allowed.includes(origin) ? origin : null),
  });
  return async (c: Context, next: Next) => {
    // El upgrade a WebSocket (voz) no pasa por CORS.
    if (c.req.header("Upgrade")?.toLowerCase() === "websocket") {
      await next();
      return;
    }
    // `return`: en el preflight (OPTIONS) hono/cors responde él mismo con un
    // Response; si se descarta, Hono no tiene respuesta y truena con 500.
    return await handler(c, next);
  };
}

export const corsMiddleware = createCorsMiddleware();
