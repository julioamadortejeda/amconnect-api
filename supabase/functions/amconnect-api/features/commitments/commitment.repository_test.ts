// CommitmentRepository.listPage: una página con conteo, en un orden estable.
import assert from "node:assert/strict";
import { FakeSupabase } from "../../shared/testing/fake_supabase.ts";
import { CommitmentRepository } from "./commitment.repository.ts";

const row = (id: string) => ({
  id, agent_id: "a", contact_id: null, label: `L${id}`, quote: "q", due_from: null, due_to: null,
  status: "OPEN", resolution_note: null, resolved_at: null, resolved_by_session_id: null,
  created_at: "2026-11-01T00:00:00Z", contact: null,
});

Deno.test("listPage: pide conteo exacto, rango de la página y desempata por id", async () => {
  const db = new FakeSupabase({ client_commitments: { data: [row("1"), row("2")], error: null, count: 5 } });
  const page = await new CommitmentRepository(db.client as never).listPage("a", {}, 2, 2);

  const q = db.queriesTo("client_commitments")[0];
  assert.deepEqual(q.args("select")?.[1], { count: "exact" });
  assert.deepEqual(q.args("range"), [2, 3]);
  assert.equal(q.ops.filter((o) => o.method === "order").length, 2);
  assert.deepEqual(q.ops.filter((o) => o.method === "order").map((o) => o.args[0]), ["due_to", "id"]);

  assert.equal(page.data.length, 2);
  assert.equal(page.total, 5);
  assert.equal(page.page, 2);
  assert.equal(page.hasMore, true);
});

Deno.test("listPage: última página no tiene más", async () => {
  const db = new FakeSupabase({ client_commitments: { data: [row("5")], error: null, count: 5 } });
  const page = await new CommitmentRepository(db.client as never).listPage("a", {}, 3, 2);
  assert.equal(page.hasMore, false);
});

Deno.test("listPage: búsqueda sin coincidencias → página vacía sin consultar la tabla de filas", async () => {
  const db = new FakeSupabase({}, { search_commitment_ids: { data: [], error: null } });
  const page = await new CommitmentRepository(db.client as never).listPage("a", { query: "nada" }, 1, 20);
  assert.deepEqual(page, { data: [], total: 0, page: 1, pageSize: 20, hasMore: false });
});

Deno.test("list (skills): sin página no pide conteo ni rango", async () => {
  const db = new FakeSupabase({ client_commitments: { data: [row("1")], error: null } });
  const rows = await new CommitmentRepository(db.client as never).list("a", {});
  const q = db.queriesTo("client_commitments")[0];
  assert.equal(q.has("range"), false);
  assert.equal(q.args("select")?.[1]?.valueOf() !== undefined && (q.args("select")?.[1] as { count?: string }).count, undefined);
  assert.equal(rows.length, 1);
});
