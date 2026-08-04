import { Context } from "hono";
import { createClient } from "@supabase/supabase-js";
import { DeviceTokenRepository } from "../../modules/agent/device_token.repository.ts";
import { ReminderRepository } from "../../modules/reminder/reminder.repository.ts";
import { NotificationService } from "../../features/notification/notification.service.ts";
import { sendSuccess } from "../../shared/api_response.ts";
import { internalError, UnauthorizedError } from "../../shared/errors.ts";

export class NotificationController {
  // Endpoint interno de cron (corre con service role, salta RLS). Se registra
  // ANTES de auth/DI en index.ts, por eso su propia validación de secret. El
  // contrato de errores es el mismo: lanzar AppError y dejar que
  // globalErrorHandler responda con { success, error, errorCode, errorId }.
  static async sendDueNotifications(c: Context) {
    const authHeader = c.req.header("Authorization");
    // Fail closed: sin secret configurado el endpoint no opera. Nunca usar un
    // fallback hardcodeado — este endpoint corre con service role (salta RLS).
    const notificationSecret = Deno.env.get("NOTIFICATION_SECRET");
    if (!notificationSecret) {
      throw internalError("Error de configuración del servidor.", "NOTIFICATION_SECRET is not configured");
    }

    if (!authHeader || authHeader !== `Bearer ${notificationSecret}`) {
      throw new UnauthorizedError("No autorizado.");
    }

    const supabaseUrl = Deno.env.get("SUPABASE_URL");
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

    if (!supabaseUrl || !supabaseServiceKey) {
      throw internalError("Error de configuración del servidor.", "Missing SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY");
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

    // Sin try/catch que trague el error (RULES §2): si el servicio falla, el
    // globalErrorHandler responde con mensaje público neutro y persiste el
    // detalle — nunca se filtra `err.message` al cliente.
    const result = await notificationService.processAndSendDueNotifications();
    return sendSuccess(c, result);
  }
}
