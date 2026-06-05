import { Context, Next } from "hono";
import { createClient } from "@supabase/supabase-js";
import { UnauthorizedError } from "../../shared/errors.ts";
import { SubscriptionService } from "../../modules/subscription/subscription.service.ts";

export const authMiddleware = async (c: Context, next: Next) => {
  const authHeader = c.req.header("Authorization");

  if (!authHeader?.startsWith("Bearer ")) {
    throw new UnauthorizedError("Token de autorización inválido o ausente.");
  }

  const token = authHeader.replace("Bearer ", "");

  const supabaseUrl = Deno.env.get("SUPABASE_URL") as string;
  const supabaseAnonKey = Deno.env.get("SUPABASE_ANON_KEY") as string;

  const supabase = createClient(supabaseUrl, supabaseAnonKey, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });

  const { data: { user }, error } = await supabase.auth.getUser(token);

  if (error || !user) {
    throw new UnauthorizedError("Token inválido o expirado.");
  }

  c.set("agent_id", user.id);
  c.set("supabase", supabase);

  const subscriptionService = new SubscriptionService(supabase);
  await subscriptionService.checkSubscriptionActive(user.id);

  await next();
};
