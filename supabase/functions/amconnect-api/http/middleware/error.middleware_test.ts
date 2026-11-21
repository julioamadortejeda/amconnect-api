// Contrato de error backend ↔ app: { success:false, error, errorCode, errorId? }.
// Se prueba el globalErrorHandler real montado en una app de prueba.
import assert from "node:assert/strict";
import { z } from "zod";
import type { Context } from "hono";
import { AppError, NotFoundError, UnauthorizedError, internalError } from "../../shared/errors.ts";
import { FakeSupabase } from "../../shared/testing/fake_supabase.ts";
import { call, createTestApp } from "../../shared/testing/test_app.ts";

function appThrowing(err: unknown) {
  const db = new FakeSupabase();
  const app = createTestApp({
    supabase: db.client,
    routes: (r) => r.get("/boom", (_c: Context) => {
      throw err;
    }),
  });
  return { db, app };
}

function silenced<T>(fn: () => Promise<T>): Promise<T> {
  const original = console.error;
  console.error = () => {};
  return fn().finally(() => (console.error = original));
}

Deno.test("error handler: AppError con código → status, mensaje y errorId del log", async () => {
  const { db, app } = appThrowing(new NotFoundError("No existe ese contacto."));
  const { status, json } = await call(app, "GET", "/boom");
  assert.equal(status, 404);
  assert.equal(json.success, false);
  assert.equal(json.error, "No existe ese contacto.");
  assert.equal(json.errorCode, "RESOURCE_NOT_FOUND");
  assert.equal(typeof json.errorId, "string");

  const insert = db.queriesTo("error_logs")[0].args("insert")?.[0] as Record<string, unknown>;
  assert.equal(insert.id, json.errorId, "el errorId que recibe la app es el id de la fila");
  assert.equal(insert.status_code, 404);
});

Deno.test("error handler: el detalle interno se guarda en el log pero NO viaja al cliente", async () => {
  const { db, app } = appThrowing(internalError("No se pudo guardar.", "contacts insert failed (23502: secret_col)"));
  const { status, json } = await silenced(() => call(app, "GET", "/boom"));
  assert.equal(status, 500);
  assert.equal(JSON.stringify(json).includes("secret_col"), false);
  const insert = db.queriesTo("error_logs")[0].args("insert")?.[0] as Record<string, unknown>;
  assert.equal(String(insert.error_message).includes("secret_col"), true);
});

for (const [status, code] of [[400, "VALIDATION_FAILED"], [402, "SUBSCRIPTION_REQUIRED"], [429, "QUOTA_EXCEEDED"], [500, "INTERNAL_ERROR"]] as const) {
  Deno.test(`error handler: AppError sin código con ${status} recibe ${code} de respaldo`, async () => {
    const { app } = appThrowing(new AppError("algo", status));
    const { json } = await silenced(() => call(app, "GET", "/boom"));
    assert.equal(json.errorCode, code);
  });
}

Deno.test("error handler: 401 no se persiste (ruido de tokens vencidos)", async () => {
  const { db, app } = appThrowing(new UnauthorizedError());
  const { status, json } = await call(app, "GET", "/boom");
  assert.equal(status, 401);
  assert.equal(json.errorCode, "SESSION_EXPIRED");
  assert.equal(db.queriesTo("error_logs").length, 0);
});

Deno.test("error handler: ZodError → 422 VALIDATION_FAILED con detalle por campo", async () => {
  const zodErr = z.object({ code: z.string().min(1) }).safeParse({ code: "" }).error;
  const { db, app } = appThrowing(zodErr);
  const { status, json } = await call(app, "GET", "/boom");
  assert.equal(status, 422);
  assert.equal(json.errorCode, "VALIDATION_FAILED");
  assert.ok((json.details as { fieldErrors: Record<string, unknown> }).fieldErrors.code);
  assert.equal(db.queriesTo("error_logs").length, 0);
});

Deno.test("error handler: 429 crudo del SDK de IA → AI_PROVIDER_BUSY", async () => {
  const sdkErr = Object.assign(new Error("RESOURCE_EXHAUSTED"), { status: 429 });
  const { app } = appThrowing(sdkErr);
  const { status, json } = await call(app, "GET", "/boom");
  assert.equal(status, 429);
  assert.equal(json.errorCode, "AI_PROVIDER_BUSY");
});

Deno.test("error handler: error no controlado → 500 genérico, sin el mensaje original", async () => {
  const { app } = appThrowing(new TypeError("Cannot read properties of undefined (reading 'agent_id')"));
  const { status, json } = await silenced(() => call(app, "GET", "/boom"));
  assert.equal(status, 500);
  assert.equal(json.errorCode, "INTERNAL_ERROR");
  assert.equal(String(json.error).includes("agent_id"), false);
});
