import { Hono } from "hono";
import { cors } from "hono/cors";
import { authMiddleware } from "./http/middleware/auth.middleware.ts";
import { injectServices } from "./http/middleware/di/index.ts";
import { globalErrorHandler } from "./http/middleware/error.middleware.ts";
import { apiRouter } from "./http/routes/index.ts";

const app = new Hono();

app.onError(globalErrorHandler);

app.use("*", cors());

app.get("/amconnect-api/health", (c) => c.json({ status: "ok", timestamp: new Date().toISOString() }));

app.use("/amconnect-api/*", authMiddleware);
app.use("/amconnect-api/*", injectServices);

app.route("/amconnect-api", apiRouter);

Deno.serve(app.fetch);
