// Registro de turnos en curso (cancelación desde /ai/sessions/:id/cancel).
import assert from "node:assert/strict";
import { ActiveTurnRegistry } from "./active_turns.ts";

Deno.test("registro: cancel aborta el turno de la sesión y dice si había uno", () => {
  const r = new ActiveTurnRegistry();
  const turn = r.register("s1");
  assert.equal(r.cancel("otra"), false);
  assert.equal(r.cancel("s1"), true);
  assert.equal(turn.signal.aborted, true);
});

Deno.test("registro: release quita el turno; el release de uno viejo no borra uno nuevo", () => {
  const r = new ActiveTurnRegistry();
  const old = r.register("s1");
  const current = r.register("s1");
  old.release();
  assert.equal(r.has("s1"), true);
  current.release();
  assert.equal(r.has("s1"), false);
  assert.equal(r.cancel("s1"), false);
});
