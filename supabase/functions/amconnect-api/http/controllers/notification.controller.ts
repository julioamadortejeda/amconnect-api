import { Context } from "hono";
import { DeviceTokenRepository } from "../../modules/agent/device_token.repository.ts";
import { ReminderRepository } from "../../modules/reminder/reminder.repository.ts";
import { NotificationService } from "../../features/notification/notification.service.ts";
import { sendSuccess } from "../../shared/api_response.ts";
import { authorizeCronRequest } from "../../shared/cron_auth.ts";

export class NotificationController {
  // Endpoint interno de cron (corre con service role, salta RLS). Se registra
  // ANTES de auth/DI en index.ts, por eso su propia validación de secret. El
  // contrato de errores es el mismo: lanzar AppError y dejar que
  // globalErrorHandler responda con { success, error, errorCode, errorId }.
  static async sendDueNotifications(c: Context) {
    const supabase = authorizeCronRequest(c);

    // Repos con el cliente de service role (necesario para saltar RLS y
    // procesar recordatorios de todos los agentes en este endpoint de cron)
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
