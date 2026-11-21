import { Context, Hono, type MiddlewareHandler } from "hono";
import { authMiddleware } from "./http/middleware/auth.middleware.ts";
import { rateLimitMiddleware } from "./http/middleware/rate_limit.middleware.ts";
import { corsMiddleware } from "./http/middleware/cors.middleware.ts";
import { injectServices } from "./http/middleware/di/index.ts";
import { globalErrorHandler } from "./http/middleware/error.middleware.ts";
import { apiRouter } from "./http/routes/index.ts";
import { sendSuccess } from "./shared/api_response.ts";
import { OpenApiController } from "./http/controllers/openapi.controller.ts";
import { NotificationController } from "./http/controllers/notification.controller.ts";
import { ReminderGenerationController } from "./http/controllers/reminder_generation.controller.ts";

export interface AppDeps {
  /** Para pruebas: reemplaza la verificación real del JWT. */
  authMiddleware?: MiddlewareHandler;
  /** Para pruebas: reemplaza el contenedor DI (que arma services contra la BD). */
  injectServices?: MiddlewareHandler;
}

// Arma la app completa. Vive aparte de index.ts (que solo hace Deno.serve) para
// que las pruebas recorran el MISMO orden de middleware que producción:
// CORS → rutas públicas → auth → límite por minuto → DI → router.
export function createApp(deps: AppDeps = {}): Hono {
  const app = new Hono();

  app.onError(globalErrorHandler);

  app.use("*", corsMiddleware);

  app.get("/amconnect-api/health", (c: Context) => sendSuccess(c, { status: "ok", timestamp: new Date().toISOString() }));

  // Contrato OpenAPI: público y sin cobro, como /health (se monta antes de auth y DI)
  app.get("/amconnect-api/openapi.json", OpenApiController.getDocument);

  // Endpoint interno disparado por pg_cron para enviar notificaciones de recordatorios vencidos
  app.post("/amconnect-api/notifications/send-due", NotificationController.sendDueNotifications);

  // Endpoint interno disparado por pg_cron (diario) para generar los recordatorios
  // de pólizas y cumpleaños que acaban de entrar en la ventana de aviso del asesor
  app.post("/amconnect-api/reminders/generate-due", ReminderGenerationController.generateDueReminders);

  app.use("/amconnect-api/*", deps.authMiddleware ?? authMiddleware);
  // Límite por minuto por asesor (D-027): después de auth (necesita al asesor) y
  // antes del DI (una petición rechazada no paga sus consultas).
  app.use("/amconnect-api/*", rateLimitMiddleware);
  app.use("/amconnect-api/*", deps.injectServices ?? injectServices);

  app.route("/amconnect-api", apiRouter);

  return app;
}
