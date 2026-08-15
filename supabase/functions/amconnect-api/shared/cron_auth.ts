import { Context } from "hono";
import { createClient, SupabaseClient } from "@supabase/supabase-js";
import { internalError, UnauthorizedError } from "./errors.ts";

/**
 * Guards an internal endpoint triggered by pg_cron and hands back a service-role
 * client. These endpoints are registered BEFORE the auth and DI middleware, so
 * they carry their own check — and they skip RLS on purpose, since they serve
 * every agent at once. This is the one documented exception to "never use the
 * service role" (RULES §3).
 */
export function authorizeCronRequest(c: Context): SupabaseClient {
  // Fail closed: with no secret configured the endpoint does not operate.
  // Never fall back to a hardcoded value — this runs with the service role.
  const notificationSecret = Deno.env.get("NOTIFICATION_SECRET");
  if (!notificationSecret) {
    throw internalError("Error de configuración del servidor.", "NOTIFICATION_SECRET is not configured");
  }

  const authHeader = c.req.header("Authorization");
  if (!authHeader || authHeader !== `Bearer ${notificationSecret}`) {
    throw new UnauthorizedError("No autorizado.");
  }

  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");
  if (!supabaseUrl || !supabaseServiceKey) {
    throw internalError("Error de configuración del servidor.", "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
  }

  return createClient(supabaseUrl, supabaseServiceKey, { auth: { persistSession: false } });
}
