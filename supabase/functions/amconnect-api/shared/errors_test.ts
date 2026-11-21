import assert from "node:assert/strict";
import type { PostgrestError } from "@supabase/supabase-js";
import { AppError, handleSupabaseError } from "./errors.ts";

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
