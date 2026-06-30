import { Context, Hono } from "hono";
import { cors } from "hono/cors";
import { authMiddleware } from "./http/middleware/auth.middleware.ts";
import { injectServices } from "./http/middleware/di/index.ts";
import { globalErrorHandler } from "./http/middleware/error.middleware.ts";
import { apiRouter } from "./http/routes/index.ts";
import { NotificationController } from "./http/controllers/notification.controller.ts";

const app = new Hono();

app.onError(globalErrorHandler);

const allowedOrigin = Deno.env.get("ALLOWED_ORIGIN");
app.use("*", async (c, next) => {
  if (c.req.header("Upgrade")?.toLowerCase() === "websocket") {
    console.log(`[HTTP] WebSocket request detected on ${c.req.path} — bypassing CORS middleware`);
    await next();
    return;
  }
  await cors(allowedOrigin ? { origin: allowedOrigin } : {})(c, next);
});

app.get("/amconnect-api/health", (c: Context) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

// Endpoint interno disparado por pg_cron para enviar notificaciones de recordatorios vencidos
app.post("/amconnect-api/notifications/send-due", NotificationController.sendDueNotifications);

app.use("/amconnect-api/*", authMiddleware);
app.use("/amconnect-api/*", injectServices);

app.route("/amconnect-api", apiRouter);

Deno.serve(app.fetch);
