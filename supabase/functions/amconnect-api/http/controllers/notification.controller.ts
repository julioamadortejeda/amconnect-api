import { Context } from "hono";
import { createClient } from "@supabase/supabase-js";
import { DeviceTokenRepository } from "../../modules/agent/device_token.repository.ts";
import { ReminderRepository } from "../../modules/reminder/reminder.repository.ts";
import { NotificationService } from "../../features/notification/notification.service.ts";

export class NotificationController {
  static async sendDueNotifications(c: Context) {
    const authHeader = c.req.header("Authorization");
    const notificationSecret = Deno.env.get("NOTIFICATION_SECRET") ?? "super-secret-notification-token";

    if (!authHeader || authHeader !== `Bearer ${notificationSecret}`) {
      return c.json({ error: "Unauthorized" }, 401);
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL") as string;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") as string;

    if (!supabaseUrl || !supabaseServiceKey) {
      console.error("[NotificationController] Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
      return c.json({ error: "Internal server configuration error" }, 500);
    }

    // Creamos cliente con service role para saltar RLS y buscar recordatorios de todos los agentes
    const supabase = createClient(supabaseUrl, supabaseServiceKey, {
      auth: { persistSession: false }
    });

    // Instanciar repos con el cliente de service role (necesario para saltar RLS
    // y procesar recordatorios de todos los agentes en este endpoint de cron)
    const deviceTokenRepo = new DeviceTokenRepository(supabase);
    const reminderRepo = new ReminderRepository(supabase);
    const notificationService = new NotificationService(deviceTokenRepo, reminderRepo);

    try {
      const result = await notificationService.processAndSendDueNotifications();
      return c.json(result);
    } catch (err) {
      console.error("[NotificationController] Error running sendDueNotifications service method:", err);
      return c.json({ error: (err as Error).message }, 500);
    }
  }
}
