import { Context, Hono } from "hono";
import { cors } from "hono/cors";
import { authMiddleware } from "./http/middleware/auth.middleware.ts";
import { injectServices } from "./http/middleware/di/index.ts";
import { globalErrorHandler } from "./http/middleware/error.middleware.ts";
import { apiRouter } from "./http/routes/index.ts";
import { NotificationController } from "./http/controllers/notification.controller.ts";
import { ReminderGenerationController } from "./http/controllers/reminder_generation.controller.ts";

const app = new Hono();

app.onError(globalErrorHandler);

const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN");
app.use("*", async (c, next) => {
  if (c.req.header("Upgrade")?.toLowerCase() === "websocket") {
    await next();
    return;
  }
  await cors(allowedOrigin ? { origin: allowedOrigin } : {})(c, next);
});

app.get("/amconnect-api/health", (c: Context) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

// Endpoint interno disparado por pg_cron para enviar notificaciones de recordatorios vencidos
app.post("/amconnect-api/notifications/send-due", NotificationController.sendDueNotifications);

// Endpoint interno disparado por pg_cron (diario) para generar los recordatorios
// de pólizas y cumpleaños que acaban de entrar en la ventana de aviso del asesor
app.post("/amconnect-api/reminders/generate-due", ReminderGenerationController.generateDueReminders);

app.use("/amconnect-api/*", authMiddleware);
app.use("/amconnect-api/*", injectServices);

app.route("/amconnect-api", apiRouter);

Deno.serve(app.fetch);
