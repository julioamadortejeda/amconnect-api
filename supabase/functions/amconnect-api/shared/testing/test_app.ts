// Fábrica de una app Hono para probar middleware y controllers sin red.
//
// Reemplaza a `authMiddleware` (que valida el JWT contra Supabase Auth) por uno
// que solo pone `agent_id` y `supabase` en el contexto, y conecta el
// `globalErrorHandler` real, así que las respuestas de error son las mismas que
// ve la app: `{ success: false, error, errorCode, errorId? }`.
import { Hono, type Context, type MiddlewareHandler } from "hono";
import type { SupabaseClient } from "@supabase/supabase-js";
import { globalErrorHandler } from "../../http/middleware/error.middleware.ts";

export const TEST_AGENT_ID = "a1a1a1a1-0000-4000-8000-00000000000a";
export const BASE_PATH = "/amconnect-api";

export interface TestAppOptions {
  supabase: SupabaseClient;
  agentId?: string;
  /** Middleware a montar en `/amconnect-api/*` después de la "auth" (p. ej. injectServices). */
  middleware?: MiddlewareHandler[];
  /** Valores extra para el contexto (p. ej. services falsos que un controller lee con c.get). */
  context?: Record<string, unknown>;
  /** Registra las rutas sobre el router montado en `/amconnect-api`. */
  routes: (router: Hono) => void;
}

export function createTestApp(opts: TestAppOptions): Hono {
  const app = new Hono();
  app.onError(globalErrorHandler);

  app.use(`${BASE_PATH}/*`, async (c: Context, next) => {
    c.set("agent_id", opts.agentId ?? TEST_AGENT_ID);
    c.set("supabase", opts.supabase);
    for (const [k, v] of Object.entries(opts.context ?? {})) c.set(k as never, v as never);
    await next();
  });
  for (const mw of opts.middleware ?? []) app.use(`${BASE_PATH}/*`, mw);

  const router = new Hono();
  opts.routes(router);
  app.route(BASE_PATH, router);
  return app;
}

/** Atajo: hace la petición y devuelve status + JSON. */
export async function call(
  app: Hono,
  method: string,
  path: string,
  body?: unknown,
): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await app.request(`${BASE_PATH}${path}`, {
    method,
    headers: body === undefined ? {} : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json() };
}
