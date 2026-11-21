import "../../shared/testing/test_env.ts";
import assert from "node:assert/strict";
import { RecallService, type RecallSources } from "./recall.service.ts";
import { RecallSearchService } from "./recall_search.service.ts";
import type { SearchHit, SearchOptions } from "../../shared/search_hits.ts";
import type { NoteMatch } from "../rag/rag.repository.ts";
import { RECALL_GROUP_LIMIT, RECALL_MAX_PER_DOCUMENT } from "./recall.config.ts";

const chunk = (chunkId: string, noteId: string, sourceType = "pdf"): NoteMatch => ({
  chunkId, noteId, content: `c ${chunkId}`, contactId: null, policyId: null, similarity: 0.9,
  sourceType, createdAt: "2026-01-01", storagePath: null, fileName: `${noteId}.pdf`,
});
const noteHit = (m: NoteMatch, rank: number): SearchHit<NoteMatch> => ({ source: "note", id: m.chunkId, rank, item: m });
const simpleHits = <T>(source: SearchHit<T>["source"], n: number, mk: (i: number) => T): SearchHit<T>[] =>
  Array.from({ length: n }, (_, i) => ({ source, id: `${source}-${i}`, rank: i + 1, item: mk(i) }));

interface Calls { opts: Record<string, SearchOptions[]>; embeds: number; stored: number }

function setup(over: Partial<{ failing: string; contacts: number; docChunks: NoteMatch[]; textChunks: NoteMatch[] }> = {}) {
  const calls: Calls = { opts: {}, embeds: 0, stored: 0 };
  const rec = (k: string, o?: SearchOptions) => (calls.opts[k] ??= []).push(o ?? {});
  const guard = (k: string) => over.failing === k ? Promise.reject(new Error(`fallo ${k}`)) : null;
  const sources = {
    contacts: { searchHits: (_a: string, _q: string, o?: SearchOptions) => (rec("contacts", o), guard("contacts") ?? Promise.resolve(simpleHits("contact", over.contacts ?? 3, (i) => ({ id: `c${i}` })))) },
    policies: { searchHits: (_a: string, _q: string, o?: SearchOptions) => (rec("policies", o), guard("policies") ?? Promise.resolve([])) },
    reminders: { searchHits: (_a: string, _q: string, o?: SearchOptions) => (rec("reminders", o), Promise.resolve([])) },
    commitments: { searchHits: (_a: string, _q: string, o?: SearchOptions) => (rec("commitments", o), Promise.resolve([])) },
    notes: {
      searchHits: (_a: string, _q: string, o?: SearchOptions) => {
        rec(`vec:${o?.sourceTypes?.join(",")}`, o);
        return Promise.resolve((over.docChunks ?? []).map((m, i) => noteHit(m, i + 1)));
      },
      searchTextHits: (_a: string, _q: string, o?: SearchOptions) => {
        rec(`txt:${o?.sourceTypes?.join(",")}`, o);
        return guard("text") ?? Promise.resolve((over.textChunks ?? []).map((m, i) => noteHit(m, i + 1)));
      },
    },
  } as unknown as RecallSources;
  const searches = new RecallSearchService({
    findValid: () => Promise.resolve(null),
    insert: () => (calls.stored++, Promise.resolve("sid-1")),
    deleteExpired: () => Promise.resolve(),
  }, () => (calls.embeds++, Promise.resolve([0.5])));
  return { service: new RecallService(sources, searches), calls };
}

Deno.test("recall: llama a las seis fuentes, separa notas y documentos por source_type y devuelve searchId", async () => {
  const { service, calls } = setup({ docChunks: [chunk("1", "n1")] });
  const r = await service.recall("a1", { query: "hernia" });
  assert.equal(r.searchId, "sid-1");
  assert.deepEqual(Object.keys(r.groups).sort(), ["commitments", "contacts", "documents", "notes", "policies", "reminders"]);
  assert.deepEqual(calls.opts["vec:text"][0].sourceTypes, ["text"]);
  assert.deepEqual(calls.opts["vec:pdf,image,audio,document"][0].sourceTypes, ["pdf", "image", "audio", "document"]);
  assert.deepEqual(calls.opts["vec:text"][0].queryEmbedding, [0.5]);
  assert.equal(calls.embeds, 1, "un solo embedding aunque haya dos grupos de fragmentos");
});

Deno.test("recall: RRF junta vector y texto, aplica tope por documento y moreInDocument", async () => {
  const vec = Array.from({ length: RECALL_MAX_PER_DOCUMENT + 2 }, (_, i) => chunk(`v${i}`, "big"));
  const { service } = setup({ docChunks: [...vec, chunk("o1", "other")], textChunks: [chunk("t1", "txtdoc")] });
  const r = await service.recall("a1", { query: "x", groups: ["documents"] });
  const docs = r.groups.documents!.items;
  const big = docs.find((d) => d.noteId === "big")!;
  assert.equal(big.chunks.length, RECALL_MAX_PER_DOCUMENT);
  assert.equal(big.moreInDocument, true);
  assert.ok(docs.some((d) => d.noteId === "txtdoc"), "un hit solo de texto también aparece");
  assert.equal(r.groups.notes, undefined);
});

Deno.test("recall: pagina y calcula moreAvailable con límite + 1", async () => {
  const { service, calls } = setup({ contacts: RECALL_GROUP_LIMIT + 1 });
  const p1 = await service.recall("a1", { query: "x", groups: ["contacts"] });
  assert.equal(p1.groups.contacts!.items.length, RECALL_GROUP_LIMIT);
  assert.equal(p1.groups.contacts!.moreAvailable, true);
  assert.equal(calls.opts.contacts[0].limit, RECALL_GROUP_LIMIT + 1);
  const p2 = await service.recall("a1", { query: "x", groups: ["contacts"], page: 2 });
  assert.equal(p2.groups.contacts!.items.length, 1);
  assert.equal(p2.groups.contacts!.moreAvailable, false);
  assert.equal(calls.opts.contacts[1].limit, 2 * RECALL_GROUP_LIMIT + 1);
});

Deno.test("recall: sin notas/documentos no calcula embedding ni searchId", async () => {
  const { service, calls } = setup();
  const r = await service.recall("a1", { query: "x", groups: ["policies"] });
  assert.equal(calls.embeds, 0);
  assert.equal(r.searchId, "");
});

Deno.test("recall: con contact_id se salta el grupo contacts y propaga el filtro", async () => {
  const { service, calls } = setup();
  const r = await service.recall("a1", { query: "x", contactId: "c-9" });
  assert.equal(r.groups.contacts, undefined);
  assert.equal(calls.opts.policies[0].contactId, "c-9");
  assert.equal(calls.opts["txt:text"][0].contactId, "c-9");
});

Deno.test("recall: una fuente que falla hace fallar la búsqueda (nunca []) ", async () => {
  await assert.rejects(setup({ failing: "policies" }).service.recall("a1", { query: "x" }), /fallo policies/);
  await assert.rejects(setup({ failing: "text" }).service.recall("a1", { query: "x" }), /fallo text/);
});
