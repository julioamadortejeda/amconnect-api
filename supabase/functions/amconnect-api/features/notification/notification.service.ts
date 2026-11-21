import { IDeviceTokenRepository } from "../../modules/agent/device_token.repository.ts";
import { DueReminderRow, INotificationReminderRepository } from "../../modules/reminder/reminder.repository.ts";
import type { ErrorLogInput } from "../../modules/error_log/error_log.service.ts";
import { FcmHttpClient, IPushSender, PushPayload } from "./fcm.client.ts";

export type { PushPayload } from "./fcm.client.ts";

/** Lo mínimo que el cron necesita para dejar rastro en `error_logs`. */
export interface ICronErrorLogger {
  log(input: ErrorLogInput): Promise<string | null>;
}

/** Cuántos recordatorios toma una corrida (el cron corre cada minuto). */
const CLAIM_LIMIT = 100;
/** Espera mínima antes de reintentar un recordatorio que falló o quedó a medias. */
const LEASE_SECONDS = 300;
/** Intentos por recordatorio (≈30 min con el lease de 5) antes de rendirse. */
const MAX_ATTEMPTS = 6;
/** Recordatorios que se envían en paralelo. */
const SEND_CONCURRENCY = 8;

export interface AgentPushResult {
  tokens: number;
  sent: number;
  transient: number;
  permanent: number;
  unregistered: number;
  /** Último código de error visto, para el diagnóstico. */
  lastError?: string;
}

export interface DueNotificationsResult {
  success: boolean;
  /** Recordatorios reclamados en esta corrida. */
  processed: number;
  notified: number;
  /** Fallaron de forma transitoria y se reintentarán. */
  retrying: number;
  /** Se dejaron de intentar (sin dispositivos, rechazados o tope de intentos). */
  gaveUp: number;
  errors: number;
}

type ReminderOutcome = "notified" | "retrying" | "gave_up" | "error";

export class NotificationService {
  private readonly sender: IPushSender;

  constructor(
    private deviceTokenRepo: IDeviceTokenRepository,
    private reminderRepo: INotificationReminderRepository,
    sender?: IPushSender,
    private errorLogger?: ICronErrorLogger,
  ) {
    // FcmHttpClient lee las credenciales hasta el primer envío, no al construirse.
    this.sender = sender ?? new FcmHttpClient();
  }

  /**
   * Envía a todos los dispositivos del asesor y devuelve qué pasó con cada uno.
   * Ya no "regresa en silencio": quien llama decide según el resultado.
   */
  async sendPushToAgent(agentId: string, payload: PushPayload): Promise<AgentPushResult> {
    const rows = await this.deviceTokenRepo.findByAgentId(agentId) ?? [];
    const result: AgentPushResult = { tokens: rows.length, sent: 0, transient: 0, permanent: 0, unregistered: 0 };

    await Promise.all(rows.map(async (row) => {
      const token = row.token as string;
      const res = await this.sender.send(token, payload);
      result[res.outcome]++;
      if (res.outcome !== "sent") result.lastError = res.errorCode ?? `HTTP_${res.status ?? "?"}`;

      if (res.outcome === "unregistered") {
        // Solo con UNREGISTERED/404 o INVALID_ARGUMENT que señala al token.
        console.warn(`[NotificationService] Deleting dead device token ${token.substring(0, 10)}...`);
        await this.deviceTokenRepo.deleteByToken(token);
      } else if (res.outcome !== "sent") {
        console.warn(
          `[NotificationService] FCM ${res.outcome} failure (status ${res.status ?? "-"}, ${res.errorCode ?? "-"}) for token ${token.substring(0, 10)}...`,
        );
      }
    }));

    return result;
  }

  async processAndSendDueNotifications(): Promise<DueNotificationsResult> {
    const reminders = await this.reminderRepo.claimDue({
      limit: CLAIM_LIMIT,
      leaseSeconds: LEASE_SECONDS,
      maxAttempts: MAX_ATTEMPTS,
    });

    const counts = { notified: 0, retrying: 0, gave_up: 0, error: 0 };
    const failures: Array<{ reminderId: string; outcome: ReminderOutcome; reason: string }> = [];

    await runWithConcurrency(reminders, SEND_CONCURRENCY, async (reminder) => {
      const { outcome, reason } = await this.deliver(reminder);
      counts[outcome]++;
      if (outcome !== "notified") failures.push({ reminderId: reminder.id, outcome, reason });
    });

    const result: DueNotificationsResult = {
      success: true,
      processed: reminders.length,
      notified: counts.notified,
      retrying: counts.retrying,
      gaveUp: counts.gave_up,
      errors: counts.error,
    };

    // Sin dispositivos es normal (el asesor no ha abierto la app): no es una
    // falla del sistema y no ensucia error_logs.
    const systemFailures = failures.filter((f) => f.reason !== "NO_DEVICES");
    if (systemFailures.length > 0) await this.logRunFailures(result, systemFailures);
    return result;
  }

  private async deliver(reminder: DueReminderRow): Promise<{ outcome: ReminderOutcome; reason: string }> {
    try {
      const push = await this.sendPushToAgent(reminder.agent_id, {
        title: `Recordatorio: ${reminder.title}`,
        body: reminder.description ?? "Tienes un recordatorio pendiente.",
        data: { reminderId: reminder.id, type: "reminder" },
      });

      // Al menos un dispositivo lo recibió: notificado.
      if (push.sent > 0) {
        const marked = await this.reminderRepo.markNotified(reminder.id, reminder.due_date);
        if (marked) await this.reminderRepo.logNotification(reminder.id, reminder.agent_id, reminder.due_date);
        return { outcome: "notified", reason: "" };
      }

      // Decisión explícita: sin dispositivos no hay a quién enviarle y reintentar
      // no cambia nada. Se rinde sin marcarlo como notificado.
      if (push.tokens === 0) {
        await this.reminderRepo.recordDeliveryFailure(reminder.id, reminder.due_date, "NO_DEVICES", true);
        return { outcome: "gave_up", reason: "NO_DEVICES" };
      }

      if (push.transient > 0) {
        const reason = push.lastError ?? "TRANSIENT";
        const giveUp = reminder.attempts >= MAX_ATTEMPTS;
        await this.reminderRepo.recordDeliveryFailure(reminder.id, reminder.due_date, reason, giveUp);
        return { outcome: giveUp ? "gave_up" : "retrying", reason };
      }

      // Todos los tokens fueron rechazados de forma definitiva o estaban muertos.
      const reason = push.lastError ?? "ALL_TOKENS_REJECTED";
      await this.reminderRepo.recordDeliveryFailure(reminder.id, reminder.due_date, reason, true);
      return { outcome: "gave_up", reason };
    } catch (err) {
      // Un recordatorio que truena no detiene a los demás. Su reclamo vence
      // solo y se reintenta en otra corrida.
      const reason = err instanceof Error ? err.message : String(err);
      console.error(`[NotificationService] Error processing reminder ${reminder.id}:`, reason);
      return { outcome: "error", reason };
    }
  }

  private async logRunFailures(
    result: DueNotificationsResult,
    failures: Array<{ reminderId: string; outcome: ReminderOutcome; reason: string }>,
  ): Promise<void> {
    if (!this.errorLogger) return;
    // Solo ids y códigos: nada de títulos ni nombres de clientes (LFPDPPP).
    await this.errorLogger.log({
      errorType: "PushDeliveryFailure",
      statusCode: 500,
      errorMessage: `push cron: ${failures.length} of ${result.processed} reminders not delivered`,
      requestPath: "/amconnect-api/notifications/send-due",
      requestMethod: "POST",
      metadata: { severity: "server", result, failures: failures.slice(0, 20) },
    });
  }
}

/** Ejecuta `fn` sobre `items` con a lo más `limit` en vuelo. */
async function runWithConcurrency<T>(items: T[], limit: number, fn: (item: T) => Promise<void>): Promise<void> {
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const item = items[next++];
      await fn(item);
    }
  });
  await Promise.all(workers);
}
