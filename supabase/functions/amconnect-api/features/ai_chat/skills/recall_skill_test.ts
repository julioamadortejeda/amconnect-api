import "../../../shared/testing/test_env.ts";
import assert from "node:assert/strict";
import { recallResult } from "./recall.mapper.ts";
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

Deno.test("recallResult: aplica el presupuesto y reporta omittedForSize", () => {
  const input: RecallResult = { searchId: "", page: 1, groups: { notes: { items: [doc("a", 50), doc("b", 50), doc("c", 50)], moreAvailable: false } } };
  const out = recallResult(input, "UTC", 120);
  assert.equal(out.groups.notes.items.length, 2);
  assert.deepEqual(out.omittedForSize, { notes: 1 });
  assert.equal("searchId" in out, false);
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
  const out = await skill.execute({ query: "hernia", contact_id: "c1", page: 2, groups: ["notes"], search_id: "s" }, ctx);
  assert.deepEqual(received, { query: "hernia", contactId: "c1", page: 2, groups: ["notes"], searchId: "s" });
  assert.equal((out as { searchId: string }).searchId, "s");
});
