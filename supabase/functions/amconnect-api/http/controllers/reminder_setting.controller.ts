import { Context } from "hono";
import { sendSuccess } from "../../shared/api_response.ts";
import { ReminderSettingRequestSchema } from "../../modules/reminder/reminder_setting.dto.ts";
import { ReminderSettingService } from "../../modules/reminder/reminder_setting.service.ts";

export class ReminderSettingController {
  static async getAll(c: Context) {
    const service: ReminderSettingService = c.get("services").reminderSettingService;
    return sendSuccess(c, await service.getEffective());
  }

  // Guarda un valor y responde con la configuración completa ya re-resuelta,
  // para que el cliente pinte sin pedirla otra vez.
  static async update(c: Context) {
    const body = ReminderSettingRequestSchema.parse(await c.req.json());
    const service: ReminderSettingService = c.get("services").reminderSettingService;
    return sendSuccess(c, await service.update(body));
  }

  // Quitar la excepción de un ramo — el ramo vuelve a seguir el default.
  static async removeOverride(c: Context) {
    const typeCode = c.req.param("typeCode") as string;
    const branchId = c.req.param("branchId") as string;
    const service: ReminderSettingService = c.get("services").reminderSettingService;
    return sendSuccess(c, await service.removeOverride(typeCode, branchId));
  }
}
