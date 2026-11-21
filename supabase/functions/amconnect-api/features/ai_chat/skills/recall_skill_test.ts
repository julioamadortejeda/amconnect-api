import "../../../shared/testing/test_env.ts";
import assert from "node:assert/strict";
import { recallResult, weighRecallItem } from "./recall.mapper.ts";
import { getSkillByName } from "./index.ts";
import type { RecallResult } from "../../recall/recall.types.ts";
import type { SkillContext } from "./skill.core.ts";

const doc = (n: string, words = 3) => ({
  noteId: n, sourceType: "pdf", fileName: "a.pdf", contactId: null, policyId: null, reminderId: null,
  createdAt: "2026-01-01", moreInDocument: false,
  chunks: [{ chunkId: `${n}-c`, noteId: n, content: Array(words).fill("palabra").join(" "), contactId: null, policyId: null, similarity: 0.9, sourceType: "pdf", createdAt: "x", storagePath: null, fileName: "a.pdf" }],
});

Deno.test("recallResult: el modelo ve extractos, nunca vectores ni puntajes; trae searchId y moreAvailable", () => {
  const input: RecallResult = { searchId: "sid", page: 1, groups: { documents: { items: [doc("n1")], moreAvailable: true } } };
  const out = recallResult(input, "America/Mexico_City");
  assert.equal(out.searchId, "sid");
  assert.equal(out.groups.documents.moreAvailable, true);
  const json = JSON.stringify(out);
  assert.ok(!json.includes("similarity") && !json.includes("embedding") && !json.includes("chunkId"));
  assert.deepEqual((out.groups.documents.items[0] as { excerpts: string[] }).excerpts, ["palabra palabra palabra"]);
});

Deno.test("weighRecallItem: pesa lo que el modelo ve (extractos recortados), no el DTO crudo", () => {
  const small = weighRecallItem("documents", doc("a", 3));
  const big = weighRecallItem("documents", doc("a", 50));
  assert.ok(big > small && big >= 50);
  assert.equal(weighRecallItem("chunks", doc("a", 7).chunks[0]), 7);
});

Deno.test("recallResult: no recorta ni inventa campos de paginación (omittedForSize ya no existe)", () => {
  const input: RecallResult = { searchId: "", page: 1, groups: { notes: { items: [doc("a", 50), doc("b", 50)], moreAvailable: true } } };
  const out = recallResult(input, "UTC");
  assert.equal(out.groups.notes.items.length, 2);
  assert.equal(out.groups.notes.moreAvailable, true);
  assert.equal("omittedForSize" in out, false);
});

Deno.test("skill recall: valida args y es un adaptador delgado sobre RecallService", async () => {
  const skill = getSkillByName("recall")!;
  assert.ok(skill.declaration.description.includes("ONLY for open questions"));
  assert.throws(() => skill.declaration.schema.parse({}));
  assert.throws(() => skill.declaration.schema.parse({ query: "x", groups: ["nope"] }));
  let received: unknown;
  const ctx = {
    agentId: "a1", timezone: "UTC",
    recallService: { recall: (_a: string, p: unknown) => (received = p, Promise.resolve({ searchId: "s", page: 2, groups: {} })) },
  } as unknown as SkillContext;
  const out = await skill.execute({ query: "hernia", contact_id: "c1", page: 2, groups: ["notes"], search_id: "s", note_id: "n1" }, ctx);
  assert.deepEqual(received, { query: "hernia", contactId: "c1", page: 2, groups: ["notes"], searchId: "s", noteId: "n1" });
  assert.ok(skill.declaration.description.includes("note_id"));
  assert.equal((out as { searchId: string }).searchId, "s");
});
