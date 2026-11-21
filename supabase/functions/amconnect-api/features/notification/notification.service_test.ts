// Pruebas del cron de push con repos y FCM falsos.
// Correr con: deno test -A features/notification/ (desde functions/amconnect-api)
import { deepStrictEqual as assertEquals } from "node:assert";
import { NotificationService } from "./notification.service.ts";
import {
  classifyFcmError,
  FcmConfigError,
  FcmHttpClient,
  IPushSender,
  loadServiceAccount,
  PushSendResult,
} from "./fcm.client.ts";
import type { IDeviceTokenRepository } from "../../modules/agent/device_token.repository.ts";
import type {
  ClaimOptions,
  DueReminderRow,
  INotificationReminderRepository,
  PushReminderDetails,
} from "../../modules/reminder/reminder.repository.ts";
import type { PushPayload } from "./fcm.client.ts";

// ─── Fakes ──────────────────────────────────────────────────────────────────

class FakeTokens implements IDeviceTokenRepository {
  deleted: string[] = [];
  constructor(private byAgent: Record<string, string[]>) {}
  claim(): Promise<Record<string, unknown> | null> {
    return Promise.resolve(null);
  }
  findByAgentId(agentId: string) {
    return Promise.resolve((this.byAgent[agentId] ?? []).map((token) => ({ token })));
  }
  deleteOldestTokens(): Promise<void> {
    return Promise.resolve();
  }
  deleteByToken(token: string): Promise<void> {
    this.deleted.push(token);
    return Promise.resolve();
  }
}

class FakeReminders implements INotificationReminderRepository {
  notified: string[] = [];
  logged: string[] = [];
  failures: Array<{ id: string; reason: string; giveUp: boolean }> = [];
  constructor(private due: DueReminderRow[], private details: PushReminderDetails[] | Error = []) {}
  claimDue(_o: ClaimOptions) {
    return Promise.resolve(this.due);
  }
  findPushDetails(_ids: string[]) {
    return this.details instanceof Error ? Promise.reject(this.details) : Promise.resolve(this.details);
  }
  markNotified(id: string) {
    this.notified.push(id);
    return Promise.resolve(true);
  }
  recordDeliveryFailure(id: string, _d: string, reason: string, giveUp: boolean) {
    this.failures.push({ id, reason, giveUp });
    return Promise.resolve();
  }
  logNotification(reminderId: string) {
    this.logged.push(reminderId);
    return Promise.resolve();
  }
}

class FakeSender implements IPushSender {
  constructor(private byToken: Record<string, PushSendResult>) {}
  send(token: string) {
    return Promise.resolve(this.byToken[token] ?? { outcome: "sent" as const });
  }
}

class CapturingSender implements IPushSender {
  payloads: PushPayload[] = [];
  send(_token: string, payload: PushPayload) {
    this.payloads.push(payload);
    return Promise.resolve({ outcome: "sent" as const });
  }
}

const reminder = (id: string, agent: string, attempts = 1): DueReminderRow => ({
  id,
  agent_id: agent,
  title: "t",
  description: null,
  due_date: "2026-11-20T10:00:00+00:00",
  attempts,
});

// ─── NotificationService ────────────────────────────────────────────────────

Deno.test("marca notificado solo lo que sí se envió", async () => {
  const reminders = new FakeReminders([
    reminder("r-ok", "a-ok"),
    reminder("r-down", "a-down"),
    reminder("r-none", "a-none"),
  ]);
  const tokens = new FakeTokens({ "a-ok": ["tok-ok"], "a-down": ["tok-down"] });
  const sender = new FakeSender({ "tok-down": { outcome: "transient", status: 503, errorCode: "UNAVAILABLE" } });
  const logs: unknown[] = [];
  const service = new NotificationService(tokens, reminders, sender, {
    log: (i) => (logs.push(i), Promise.resolve(null)),
  });

  const result = await service.processAndSendDueNotifications();

  assertEquals(reminders.notified, ["r-ok"]);
  assertEquals(reminders.logged, ["r-ok"]);
  assertEquals(result, { success: true, processed: 3, notified: 1, retrying: 1, gaveUp: 1, errors: 0 });
  // Se envían en paralelo: el orden no importa.
  assertEquals([...reminders.failures].sort((x, y) => x.id.localeCompare(y.id)), [
    { id: "r-down", reason: "UNAVAILABLE", giveUp: false },
    { id: "r-none", reason: "NO_DEVICES", giveUp: true },
  ]);
  // La falla de FCM queda en error_logs; "sin dispositivos" no es falla del sistema.
  assertEquals(logs.length, 1);
});

Deno.test("en el último intento una falla transitoria se rinde", async () => {
  const reminders = new FakeReminders([reminder("r", "a", 6)]);
  const service = new NotificationService(
    new FakeTokens({ a: ["tok"] }),
    reminders,
    new FakeSender({ tok: { outcome: "transient", status: 429 } }),
  );
  const result = await service.processAndSendDueNotifications();
  assertEquals(result.gaveUp, 1);
  assertEquals(reminders.failures[0].giveUp, true);
  assertEquals(reminders.notified, []);
});

Deno.test("borra solo los tokens muertos y basta un dispositivo para notificar", async () => {
  const reminders = new FakeReminders([reminder("r", "a")]);
  const tokens = new FakeTokens({ a: ["dead", "bad-payload", "alive"] });
  const sender = new FakeSender({
    dead: { outcome: "unregistered", status: 404, errorCode: "UNREGISTERED" },
    "bad-payload": { outcome: "permanent", status: 400, errorCode: "INVALID_ARGUMENT" },
  });
  await new NotificationService(tokens, reminders, sender).processAndSendDueNotifications();
  assertEquals(tokens.deleted, ["dead"]);
  assertEquals(reminders.notified, ["r"]);
});

Deno.test("todos los tokens rechazados: se rinde sin marcar notificado", async () => {
  const reminders = new FakeReminders([reminder("r", "a")]);
  const sender = new FakeSender({ only: { outcome: "unregistered", status: 404, errorCode: "UNREGISTERED" } });
  await new NotificationService(new FakeTokens({ a: ["only"] }), reminders, sender).processAndSendDueNotifications();
  assertEquals(reminders.notified, []);
  assertEquals(reminders.failures, [{ id: "r", reason: "UNREGISTERED", giveUp: true }]);
});

// ─── Clasificación de errores de FCM ────────────────────────────────────────

Deno.test("INVALID_ARGUMENT borra el token solo si FCM culpa al token", () => {
  const tokenBody = {
    error: {
      status: "INVALID_ARGUMENT",
      message: "The registration token is not a valid FCM registration token",
      details: [
        { "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode: "INVALID_ARGUMENT" },
        { "@type": "type.googleapis.com/google.rpc.BadRequest", fieldViolations: [{ field: "message.token" }] },
      ],
    },
  };
  const payloadBody = {
    error: {
      status: "INVALID_ARGUMENT",
      message: "Invalid value at 'message.data[0].value'",
      details: [
        { "@type": "type.googleapis.com/google.firebase.fcm.v1.FcmError", errorCode: "INVALID_ARGUMENT" },
        { "@type": "type.googleapis.com/google.rpc.BadRequest", fieldViolations: [{ field: "message.data[0].value" }] },
      ],
    },
  };
  assertEquals(classifyFcmError(400, tokenBody), "unregistered");
  assertEquals(classifyFcmError(400, payloadBody), "permanent");
  assertEquals(classifyFcmError(404, {}), "unregistered");
  assertEquals(classifyFcmError(503, {}), "transient");
  assertEquals(classifyFcmError(429, {}), "transient");
  assertEquals(classifyFcmError(403, { error: { details: [{ errorCode: "SENDER_ID_MISMATCH" }] } }), "transient");
});

// ─── Reintentos del cliente HTTP ────────────────────────────────────────────

function fakeFetch(responses: Array<() => Response>) {
  let calls = 0;
  const fn = (() => {
    const next = responses[Math.min(calls, responses.length - 1)];
    calls++;
    return Promise.resolve(next());
  }) as unknown as typeof fetch;
  return { fn, calls: () => calls };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) => () =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json", ...headers } });

const creds = { projectId: "p", accessToken: "t" };

Deno.test("reintenta en 503/429 y termina enviando", async () => {
  const sleeps: number[] = [];
  const f = fakeFetch([json(503, {}), json(429, {}, { "retry-after": "1" }), json(200, { name: "ok" })]);
  const client = new FcmHttpClient({
    fetchFn: f.fn,
    credentials: creds,
    sleep: (ms) => (sleeps.push(ms), Promise.resolve()),
  });
  const res = await client.send("tok", { title: "a", body: "b" });
  assertEquals(res.outcome, "sent");
  assertEquals(f.calls(), 3);
  assertEquals(sleeps, [500, 1000]);
});

Deno.test("respeta el tope de reintentos y reporta transitorio", async () => {
  const f = fakeFetch([json(500, { error: { status: "INTERNAL" } })]);
  const client = new FcmHttpClient({ fetchFn: f.fn, credentials: creds, sleep: () => Promise.resolve(), maxRetries: 2 });
  const res = await client.send("tok", { title: "a", body: "b" });
  assertEquals(res.outcome, "transient");
  assertEquals(f.calls(), 3);
});

Deno.test("no reintenta un token no registrado", async () => {
  const f = fakeFetch([json(404, { error: { status: "NOT_FOUND", details: [{ errorCode: "UNREGISTERED" }] } })]);
  const client = new FcmHttpClient({ fetchFn: f.fn, credentials: creds, sleep: () => Promise.resolve() });
  const res = await client.send("tok", { title: "a", body: "b" });
  assertEquals(res.outcome, "unregistered");
  assertEquals(f.calls(), 1);
});

Deno.test("sin credenciales no llama a FCM y queda como transitorio", async () => {
  const f = fakeFetch([json(200, {})]);
  const client = new FcmHttpClient({ fetchFn: f.fn, credentials: null });
  const res = await client.send("tok", { title: "a", body: "b" });
  assertEquals(res.outcome, "transient");
  assertEquals(f.calls(), 0);
});

Deno.test("FCM lee SOLO FCM_SERVICE_ACCOUNT y toma el project_id de ahí", () => {
  const sa = { project_id: "amconnect-jacatsoft", client_email: "x@y", private_key: "k" };
  const env = (n: string) =>
    n === "FCM_SERVICE_ACCOUNT"
      ? JSON.stringify(sa)
      : n === "FIREBASE_SERVICE_ACCOUNT"
      ? JSON.stringify({ ...sa, project_id: "amconnect-project" })
      : undefined;
  assertEquals(loadServiceAccount(env).project_id, "amconnect-jacatsoft");
});

Deno.test("sin FCM_SERVICE_ACCOUNT lanza error de configuración aunque exista FIREBASE_SERVICE_ACCOUNT", () => {
  const env = (n: string) => n === "FIREBASE_SERVICE_ACCOUNT" ? "{\"project_id\":\"old\"}" : undefined;
  let err: unknown;
  try {
    loadServiceAccount(env);
  } catch (e) {
    err = e;
  }
  assertEquals(err instanceof FcmConfigError, true);
});

Deno.test("send sin el secreto no truena: responde transitorio FCM_CONFIG_MISSING", async () => {
  const f = fakeFetch([json(200, {})]);
  const client = new FcmHttpClient({ fetchFn: f.fn });
  const res = await client.send("tok", { title: "a", body: "b" });
  assertEquals(res.outcome, "transient");
  assertEquals(res.errorCode, "FCM_CONFIG_MISSING");
  assertEquals(f.calls(), 0);
});

// ─── Texto del push (D-023/D-024) ───────────────────────────────────────────

const rosaPayment = (locale: string | null): PushReminderDetails => ({
  id: "r-1",
  title: "Pago de Prima · GMM-2026-10451",
  description: null,
  titleTemplate: "PAYMENT_DUE",
  templateData: { dueDate: "2026-11-23", amount: 2850, currency: "MXN" },
  occurrenceDate: "2026-11-23",
  contact: { fullName: "Rosa Martínez Hernández" },
  policy: { policyNumber: "GMM-2026-10451", product: { name: "ALFA MEDICAL INTEGRO", branch: null } },
  locale,
});

Deno.test("push: automático en el idioma del asesor, con producto, cliente y fecha", async () => {
  for (const [locale, title, bodyStart] of [
    ["en", "Payment · ALFA MEDICAL INTEGRO · Rosa Martínez Hernández", "Due November 23"],
    ["es", "Pago · ALFA MEDICAL INTEGRO · Rosa Martínez Hernández", "Vence el 23 de noviembre"],
  ]) {
    const sender = new CapturingSender();
    const service = new NotificationService(
      new FakeTokens({ a: ["tok"] }),
      new FakeReminders([reminder("r-1", "a")], [rosaPayment(locale)]),
      sender,
    );
    await service.processAndSendDueNotifications();
    assertEquals(sender.payloads[0].title, title);
    assertEquals(sender.payloads[0].body.startsWith(bodyStart), true);
  }
});

Deno.test("push: si el detalle no se puede leer, sale igual con el texto guardado", async () => {
  const sender = new CapturingSender();
  const reminders = new FakeReminders([reminder("r-1", "a")], new Error("boom"));
  const service = new NotificationService(new FakeTokens({ a: ["tok"] }), reminders, sender);
  await service.processAndSendDueNotifications();
  assertEquals(sender.payloads[0], {
    title: "Recordatorio: t",
    body: "Tienes un recordatorio pendiente.",
    data: { reminderId: "r-1", type: "reminder" },
  });
  assertEquals(reminders.notified, ["r-1"]);
});
