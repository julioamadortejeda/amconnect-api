import { importPKCS8, SignJWT } from "jose";

export interface PushPayload {
  title: string;
  body: string;
  data?: Record<string, string>;
}

/**
 * Resultado de enviar a UN token. La diferencia que importa al cron:
 * - `sent`: FCM lo aceptó.
 * - `unregistered`: el token ya no sirve (app desinstalada o token inválido) — se borra.
 * - `transient`: vale la pena reintentar más tarde (5xx, 429, red, credenciales).
 * - `permanent`: FCM lo rechazó y reintentar no cambia nada, pero el token no
 *   es el culpable (p. ej. un payload mal formado) — NO se borra.
 */
export type PushOutcome = "sent" | "unregistered" | "transient" | "permanent";

export interface PushSendResult {
  outcome: PushOutcome;
  status?: number;
  errorCode?: string;
}

export interface IPushSender {
  send(token: string, payload: PushPayload): Promise<PushSendResult>;
}

interface FcmErrorBody {
  error?: {
    status?: string;
    message?: string;
    details?: Array<{
      "@type"?: string;
      errorCode?: string;
      fieldViolations?: Array<{ field?: string; description?: string }>;
    }>;
  };
}

/** El código de FCM (`UNREGISTERED`, `INVALID_ARGUMENT`...) o el status de Google. */
export function fcmErrorCode(body: FcmErrorBody | null | undefined): string {
  const details = body?.error?.details ?? [];
  const fcm = details.find((d) => d["@type"]?.endsWith("google.firebase.fcm.v1.FcmError"));
  return fcm?.errorCode ?? details.find((d) => d.errorCode)?.errorCode ?? body?.error?.status ?? "";
}

/**
 * Clasifica una respuesta de error de FCM. Un 400 `INVALID_ARGUMENT` solo cuenta
 * como token muerto si FCM señala el campo `message.token`: el mismo código sale
 * con un payload mal formado, y borrar el token por eso dejaba sin push a un
 * asesor con un dispositivo perfectamente válido.
 */
export function classifyFcmError(status: number, body: FcmErrorBody | null | undefined): PushOutcome {
  const code = fcmErrorCode(body);
  if (status === 404 || code === "UNREGISTERED") return "unregistered";

  if (status === 400 && code === "INVALID_ARGUMENT") {
    const blamesToken = (body?.error?.details ?? []).some((d) =>
      (d.fieldViolations ?? []).some((v) => v.field === "message.token")
    ) || /registration token/i.test(body?.error?.message ?? "");
    return blamesToken ? "unregistered" : "permanent";
  }

  // 429/5xx: FCM saturado o caído. 401/403 (incluye SENDER_ID_MISMATCH): problema
  // de credenciales o de proyecto Firebase, no del token — se reintenta por si
  // se corrige, y nunca se borra el token por eso.
  if (status === 429 || status >= 500 || status === 401 || status === 403) return "transient";
  return "permanent";
}

function isRetryableNow(status: number): boolean {
  return status === 429 || status >= 500;
}

// ─── Credenciales ───────────────────────────────────────────────────────────

type ServiceAccount = { project_id?: string; client_email?: string; private_key?: string };

function cleanEnv(value: string): string {
  return value.trim().replace(/^['"]|['"]$/g, "").replace(/%$/, "").trim();
}

function loadServiceAccount(): ServiceAccount | null {
  let json = Deno.env.get("FIREBASE_SERVICE_ACCOUNT");
  if (json) json = cleanEnv(json);
  if (!json) {
    const base64 = Deno.env.get("FIREBASE_SERVICE_ACCOUNT_BASE64");
    if (base64) {
      const cleaned = cleanEnv(base64);
      // Auto-recuperación: si se pegó el JSON directo bajo el nombre BASE64
      if (cleaned.startsWith("{")) json = cleaned;
      else {
        try {
          json = atob(cleaned.replace(/\s/g, ""));
        } catch (err) {
          console.error("[FCM] Error decoding base64 service account:", err);
        }
      }
    }
  }
  if (!json) return null;
  try {
    return JSON.parse(json);
  } catch (err) {
    console.error("[FCM] Error parsing service account JSON:", err);
    return null;
  }
}

// Caché a nivel de módulo: el cliente se crea en cada corrida del cron (cada
// minuto) y antes firmaba y canjeaba un JWT nuevo cada vez.
let cachedToken: { token: string; expiresAt: number } | null = null;

async function fetchAccessToken(sa: ServiceAccount, fetchFn: typeof fetch): Promise<string | null> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.expiresAt > now + 300) return cachedToken.token;
  try {
    const privateKey = await importPKCS8(sa.private_key as string, "RS256");
    const jwt = await new SignJWT({ scope: "https://www.googleapis.com/auth/firebase.messaging" })
      .setProtectedHeader({ alg: "RS256", typ: "JWT" })
      .setIssuer(sa.client_email as string)
      .setAudience("https://oauth2.googleapis.com/token")
      .setExpirationTime("1h")
      .setIssuedAt()
      .sign(privateKey);

    const response = await fetchFn("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion: jwt }),
    });
    if (!response.ok) {
      console.error(`[FCM] OAuth token request failed with status ${response.status}`);
      await response.body?.cancel();
      return null;
    }
    const data = await response.json();
    cachedToken = { token: data.access_token, expiresAt: now + (data.expires_in ?? 3600) };
    return cachedToken.token;
  } catch (err) {
    console.error("[FCM] Error obtaining access token:", err instanceof Error ? err.message : String(err));
    return null;
  }
}

// ─── Cliente HTTP v1 ────────────────────────────────────────────────────────

export interface FcmHttpClientOptions {
  fetchFn?: typeof fetch;
  sleep?: (ms: number) => Promise<void>;
  /** Reintentos inmediatos por token ante 429/5xx/red, además del primer intento. */
  maxRetries?: number;
  /** Para pruebas: credenciales ya resueltas, sin leer env ni ir a OAuth. */
  credentials?: { projectId: string; accessToken: string } | null;
}

const MAX_RETRY_AFTER_MS = 5000;

export class FcmHttpClient implements IPushSender {
  private readonly fetchFn: typeof fetch;
  private readonly sleep: (ms: number) => Promise<void>;
  private readonly maxRetries: number;
  private readonly fixedCredentials?: { projectId: string; accessToken: string } | null;
  private serviceAccount: ServiceAccount | null | undefined;

  constructor(options: FcmHttpClientOptions = {}) {
    this.fetchFn = options.fetchFn ?? fetch;
    this.sleep = options.sleep ?? ((ms) => new Promise((r) => setTimeout(r, ms)));
    this.maxRetries = options.maxRetries ?? 2;
    this.fixedCredentials = options.credentials;
  }

  private async credentials(): Promise<{ projectId: string; accessToken: string } | null> {
    if (this.fixedCredentials !== undefined) return this.fixedCredentials;
    if (this.serviceAccount === undefined) {
      this.serviceAccount = loadServiceAccount();
      if (!this.serviceAccount) console.error("[FCM] Firebase service account not configured");
    }
    const sa = this.serviceAccount;
    if (!sa?.project_id || !sa.private_key || !sa.client_email) return null;
    const accessToken = await fetchAccessToken(sa, this.fetchFn);
    return accessToken ? { projectId: sa.project_id, accessToken } : null;
  }

  async send(token: string, payload: PushPayload): Promise<PushSendResult> {
    const creds = await this.credentials();
    // Sin credenciales no se envía nada, pero no es culpa del token ni del
    // recordatorio: se reintenta en una corrida posterior.
    if (!creds) return { outcome: "transient", errorCode: "FCM_CREDENTIALS_UNAVAILABLE" };

    const url = `https://fcm.googleapis.com/v1/projects/${creds.projectId}/messages:send`;
    const body = JSON.stringify({
      message: {
        token,
        notification: { title: payload.title, body: payload.body },
        data: payload.data ?? {},
        apns: { payload: { aps: { sound: "default", badge: 1 } } },
      },
    });

    let last: PushSendResult = { outcome: "transient" };
    for (let attempt = 0; attempt <= this.maxRetries; attempt++) {
      let retryAfterMs: number | null = null;
      try {
        const response = await this.fetchFn(url, {
          method: "POST",
          headers: { "Content-Type": "application/json", "Authorization": `Bearer ${creds.accessToken}` },
          body,
        });
        if (response.ok) {
          await response.body?.cancel();
          return { outcome: "sent", status: response.status };
        }

        const errorBody = await response.json().catch(() => null) as FcmErrorBody | null;
        const outcome = classifyFcmError(response.status, errorBody);
        last = { outcome, status: response.status, errorCode: fcmErrorCode(errorBody) || undefined };
        if (!isRetryableNow(response.status)) return last;

        const retryAfter = Number(response.headers.get("retry-after"));
        if (Number.isFinite(retryAfter) && retryAfter > 0) retryAfterMs = retryAfter * 1000;
      } catch (err) {
        // Error de red: transitorio por definición.
        last = { outcome: "transient", errorCode: "NETWORK_ERROR" };
        console.warn("[FCM] Network error sending push:", err instanceof Error ? err.message : String(err));
      }

      if (attempt < this.maxRetries) {
        await this.sleep(Math.min(retryAfterMs ?? 500 * 2 ** attempt, MAX_RETRY_AFTER_MS));
      }
    }
    return last;
  }
}
