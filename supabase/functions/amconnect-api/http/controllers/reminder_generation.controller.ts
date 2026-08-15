import { Context } from "hono";
import { ReminderGenerationJobRepository } from "../../features/reminder_generation/reminder_generation_job.repository.ts";
import { ReminderGenerationJobService } from "../../features/reminder_generation/reminder_generation_job.service.ts";
import { sendSuccess } from "../../shared/api_response.ts";
import { authorizeCronRequest } from "../../shared/cron_auth.ts";

export class ReminderGenerationController {
  // Endpoint interno de cron (diario, 1 AM). Recorre las pólizas y contactos de
  // TODOS los agentes, por eso corre con service role y se registra antes de
  // auth/DI en index.ts, con su propia validación de secret.
  static async generateDueReminders(c: Context) {
    const supabase = authorizeCronRequest(c);

    const jobService = new ReminderGenerationJobService(
      new ReminderGenerationJobRepository(supabase),
      supabase,
    );

    const result = await jobService.run();
    return sendSuccess(c, result);
  }
}
