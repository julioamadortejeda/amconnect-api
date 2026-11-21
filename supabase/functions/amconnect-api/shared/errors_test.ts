import assert from "node:assert/strict";
import type { PostgrestError } from "@supabase/supabase-js";
import { AppError, handleSupabaseError, internalError } from "./errors.ts";

function run(code: string): AppError {
  try {
    handleSupabaseError({ code, message: 'null value in column "secret_col"', details: "", hint: "" } as PostgrestError, "tbl.insert");
  } catch (e) {
    return e as AppError;
  }
  throw new Error("did not throw");
}

for (const code of ["22007", "23502", "23514"]) {
  Deno.test(`handleSupabaseError maps ${code} to 422 without internals`, () => {
    const err = run(code);
    assert.equal(err.statusCode, 422);
    assert.equal(err.errorCode, "VALIDATION_FAILED");
    assert.equal(err.message.includes("secret_col"), false);
    assert.equal(err.internal?.includes("secret_col"), true);
  });
}

// ─── Resto del mapeo de Postgres/PostgREST → AppError ──────────────────────

const MAPPING: Array<[string, number, string | undefined]> = [
  ["PGRST116", 404, "RESOURCE_NOT_FOUND"], // .single() sin filas
  ["22P02", 422, "VALIDATION_FAILED"], // uuid mal formado
  ["23503", 422, "VALIDATION_FAILED"], // FK: el registro relacionado no existe
  ["23505", 409, "RESOURCE_CONFLICT"], // unique: duplicado
  ["42501", 500, undefined], // RLS / permisos: no se le explica al cliente
  ["XX000", 500, undefined], // cualquier otro
];

for (const [code, status, errorCode] of MAPPING) {
  Deno.test(`handleSupabaseError maps ${code} to ${status}`, () => {
    const err = run(code);
    assert.equal(err.statusCode, status);
    assert.equal(err.errorCode, errorCode);
    // El contexto (que nombra la tabla) y el código de Postgres van SOLO en internal.
    assert.equal(err.message.includes("tbl.insert"), false);
    assert.equal(err.message.includes(code), false);
    assert.equal(err.internal, `tbl.insert (${code}: null value in column "secret_col")`);
  });
}

Deno.test("internalError separa el mensaje público del detalle técnico", () => {
  const err = internalError("No se pudo guardar.", "insert into contacts failed: 23502", 503, "AI_PROVIDER_BUSY");
  assert.equal(err.message, "No se pudo guardar.");
  assert.equal(err.internal, "insert into contacts failed: 23502");
  assert.equal(err.statusCode, 503);
  assert.equal(err.errorCode, "AI_PROVIDER_BUSY");
});
