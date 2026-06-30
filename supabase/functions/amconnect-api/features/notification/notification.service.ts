import { SignJWT, importPKCS8 } from "npm:jose";
import { IDeviceTokenRepository } from "../../modules/agent/device_token.repository.ts";
import { INotificationReminderRepository } from "../../modules/reminder/reminder.repository.ts";

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

export class NotificationService {
  private accessToken: string | null = null;
  private tokenExpiry = 0;
  private serviceAccount: Record<string, string> | null = null;

  constructor(
    private deviceTokenRepo: IDeviceTokenRepository,
    private reminderRepo: INotificationReminderRepository,
  ) {
    this.loadServiceAccount();
  }

  private loadServiceAccount() {
    let serviceAccountJson = Deno.env.get("FIREBASE_SERVICE_ACCOUNT");
    if (serviceAccountJson) {
      serviceAccountJson = serviceAccountJson.trim().replace(/^['"]|['"]$/g, "").replace(/%$/, "").trim();
    }
    if (!serviceAccountJson) {
      let base64 = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_BASE64");
      if (base64) {
        const cleaned = base64.trim().replace(/^['"]|['"]$/g, "").replace(/%$/, "").trim();
        if (cleaned.startsWith("{")) {
          // Auto-recuperación: si el usuario pegó el JSON directo bajo el nombre BASE64
          serviceAccountJson = cleaned;
        } else {
          try {
            const base64Cleaned = cleaned.replace(/\s/g, "");
            serviceAccountJson = atob(base64Cleaned);
          } catch (err) {
            console.error("[NotificationService] Error decoding base64 service account:", err);
          }
        }
      }
    }

    if (serviceAccountJson) {
      try {
        this.serviceAccount = JSON.parse(serviceAccountJson);
        console.log("[NotificationService] Firebase Service Account loaded successfully.");
      } catch (err) {
        console.error("[NotificationService] Error parsing service account JSON:", err);
      }
    } else {
      console.warn("[NotificationService] Warning: Firebase Service Account not configured. Push notifications will be disabled.");
    }
  }

  private async getAccessToken(): Promise<string | null> {
    if (!this.serviceAccount) return null;

    // Si ya tenemos un token válido y no ha expirado (guardamos 5 mins de margen)
    const now = Math.floor(Date.now() / 1000);
    if (this.accessToken && this.tokenExpiry > now + 300) {
      return this.accessToken;
    }

    try {
      const privateKeyPem = this.serviceAccount.private_key;
      const privateKey = await importPKCS8(privateKeyPem, "RS256");

      const jwt = await new SignJWT({
        scope: "https://www.googleapis.com/auth/firebase.messaging",
      })
        .setProtectedHeader({ alg: "RS256", typ: "JWT" })
        .setIssuer(this.serviceAccount.client_email)
        .setAudience("https://oauth2.googleapis.com/token")
        .setExpirationTime("1h")
        .setIssuedAt()
        .sign(privateKey);

      const response = await fetch("https://oauth2.googleapis.com/token", {
        method: "POST",
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
        },
        body: new URLSearchParams({
          grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
          assertion: jwt,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        throw new Error(`Google OAuth token request failed: ${response.statusText} - ${errorText}`);
      }

      const data = await response.json();
      this.accessToken = data.access_token;
      this.tokenExpiry = now + (data.expires_in ?? 3600);
      return this.accessToken;
    } catch (err) {
      console.error("[NotificationService.getAccessToken] Error obtaining access token:", err);
      return null;
    }
  }

  async sendPushToAgent(agentId: string, payload: PushPayload): Promise<void> {
    // 1. Obtener los tokens activos del agente
    const deviceTokens = await this.deviceTokenRepo.findByAgentId(agentId);
    if (!deviceTokens || deviceTokens.length === 0) {
      console.log(`[NotificationService.sendPushToAgent] No active device tokens found for agent: ${agentId}`);
      return;
    }

    // 2. Obtener el access token de Firebase
    const accessToken = await this.getAccessToken();
    if (!accessToken) {
      console.error("[NotificationService.sendPushToAgent] Cannot send push notifications because access token is null.");
      return;
    }

    const projectId = this.serviceAccount?.project_id;
    if (!projectId) {
      console.error("[NotificationService.sendPushToAgent] Firebase Project ID is null.");
      return;
    }

    const fcmUrl = `https://fcm.googleapis.com/v1/projects/${projectId}/messages:send`;

    // 3. Enviar peticiones concurrentes
    const sendPromises = deviceTokens.map(async (deviceRow) => {
      const token = deviceRow.token as string;
      const platform = deviceRow.platform as string;

      try {
        const messageBody = {
          message: {
            token,
            notification: {
              title: payload.title,
              body: payload.body,
            },
            data: payload.data ?? {},
            apns: {
              payload: {
                aps: {
                  sound: "default",
                  badge: 1,
                },
              },
            },
          },
        };

        const response = await fetch(fcmUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${accessToken}`,
          },
          body: JSON.stringify(messageBody),
        });

        if (!response.ok) {
          const errorResponse = await response.json().catch(() => ({}));
          const status = response.status;
          const errCode = errorResponse?.error?.details?.[0]?.errorCode ?? errorResponse?.error?.status ?? "";
          
          console.warn(`[NotificationService] FCM send error (status ${status}) for token: ${token.substring(0, 10)}... Error:`, errorResponse);

          // Si el token es inválido o ya no está registrado, lo eliminamos de la BD
          if (status === 404 || status === 400 || errCode === "UNREGISTERED" || errCode === "INVALID_ARGUMENT") {
            console.log(`[NotificationService] Deleting unregistered/invalid token: ${token.substring(0, 10)}...`);
            await this.deviceTokenRepo.deleteByToken(token);
          }
        } else {
          console.log(`[NotificationService] Push sent successfully to ${platform} device token.`);
        }
      } catch (err) {
        console.error(`[NotificationService] Exception sending push to token ${token.substring(0, 10)}...:`, err);
      }
    });

    await Promise.all(sendPromises);
  }

  async processAndSendDueNotifications(): Promise<{ success: boolean; processed: number; notified: number }> {
    const reminders = await this.reminderRepo.findDueUnnotified();

    if (reminders.length === 0) {
      return { success: true, processed: 0, notified: 0 };
    }

    console.log(`[NotificationService] Found ${reminders.length} due reminders to notify.`);

    let notifiedCount = 0;

    for (const reminder of reminders) {
      try {
        await this.sendPushToAgent(reminder.agent_id, {
          title: `Recordatorio: ${reminder.title}`,
          body: reminder.description ?? "Tienes un recordatorio pendiente.",
          data: { reminderId: reminder.id, type: "reminder" },
        });

        await this.reminderRepo.markNotified(reminder.id);
        notifiedCount++;
      } catch (err) {
        console.error(`[NotificationService] Error processing reminder ${reminder.id}:`, err);
      }
    }

    return { success: true, processed: reminders.length, notified: notifiedCount };
  }
}
