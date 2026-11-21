// NoteRepository: todos los listados de notas devuelven la forma única de página.
import assert from "node:assert/strict";
import { FakeSupabase } from "../../shared/testing/fake_supabase.ts";
import { NoteRepository } from "./note.repository.ts";

const note = (id: string, extra: Record<string, unknown> = {}) => ({ id, source_type: "text", content: "c", summary: null, created_at: "2026-11-01", document_metadata: null, ...extra });

Deno.test("getByContactId: rango, conteo y orden estable", async () => {
  const db = new FakeSupabase({ agent_notes: { data: [note("1"), note("2")], error: null, count: 7 } });
  const page = await new NoteRepository(db.client).getByContactId("c1", 2, 3);
  const q = db.queriesTo("agent_notes")[0];
  assert.deepEqual(q.args("range"), [3, 5]);
  assert.deepEqual(q.args("select")?.[1], { count: "exact" });
  assert.equal(q.eq("contact_id"), "c1");
  assert.deepEqual(q.ops.filter((o) => o.method === "order").map((o) => o.args[0]), ["created_at", "id"]);
  assert.deepEqual({ ...page, data: page.data.length }, { data: 2, total: 7, page: 2, pageSize: 3, hasMore: true });
});

Deno.test("getByReminderId: última página sin más", async () => {
  const db = new FakeSupabase({ agent_notes: { data: [note("1")], error: null, count: 1 } });
  const page = await new NoteRepository(db.client).getByReminderId("r1", 1, 20);
  assert.equal(page.hasMore, false);
  assert.equal(page.total, 1);
});

Deno.test("getByPolicyId: vigentes primero, obsoletas marcadas, una sola consulta paginada", async () => {
  const db = new FakeSupabase({
    agent_notes: { data: [note("a", { is_active: true }), note("b", { is_active: false })], error: null, count: 2 },
  });
  const page = await new NoteRepository(db.client).getByPolicyId("p1", 1, 20);
  assert.equal(db.queriesTo("agent_notes").length, 1);
  const q = db.queriesTo("agent_notes")[0];
  assert.deepEqual(q.ops.filter((o) => o.method === "order").map((o) => o.args[0]), ["is_active", "created_at", "id"]);
  assert.deepEqual(page.data.map((n) => [n.id, n.isObsolete]), [["a", false], ["b", true]]);
  assert.equal(page.total, 2);
});

Deno.test("searchNotes: pide una fila de más para hasMore y omite total", async () => {
  const rows = [1, 2, 3].map((i) => ({ id: `n${i}`, contact_id: null, policy_id: null, source_type: "text", created_at: "x", content: "c", summary: null, file_name: null, storage_path: null, full_name: null }));
  const db = new FakeSupabase({}, { search_notes: { data: rows, error: null } });
  const page = await new NoteRepository(db.client).searchNotes(2, 2, " hola ");
  assert.deepEqual(db.rpcCalls[0].args, { p_query: " hola ", p_limit: 3, p_offset: 2 });
  assert.equal(page.data.length, 2);
  assert.equal(page.hasMore, true);
  assert.equal("total" in page, false);
});
