// Contrato de búsqueda que va a usar `recall` (D-013): cada fuente devuelve
// hits con id, rank 1-based en el orden de la fuente, score solo si la fuente
// tiene uno, y el DTO tal cual.
import assert from "node:assert/strict";
import { toSearchHits } from "./search_hits.ts";
import { RAG_THRESHOLD_BROAD, RAG_THRESHOLD_SCOPED, RagService } from "../features/rag/rag.service.ts";
import type { IRagRepository, NoteMatch } from "../features/rag/rag.repository.ts";
import type { IEmbeddingProvider } from "../core/embedding_provider.interface.ts";
import { ContactService } from "../modules/contact/contact.service.ts";
import type { ContactRepository } from "../modules/contact/contact.repository.ts";

Deno.test("toSearchHits: rank 1-based en el orden recibido, respeta limit, score solo si existe", () => {
  const hits = toSearchHits("policy", [{ id: "a" }, { id: "b" }, { id: "c" }], (x) => x.id, { limit: 2 });
  assert.deepEqual(hits, [
    { source: "policy", id: "a", rank: 1, item: { id: "a" } },
    { source: "policy", id: "b", rank: 2, item: { id: "b" } },
  ]);
  const scored = toSearchHits("note", [{ id: "n", s: 0.7 }], (x) => x.id, { scoreOf: (x) => x.s });
  assert.equal(scored[0].score, 0.7);
});

function noteMatch(overrides: Partial<NoteMatch> = {}): NoteMatch {
  return {
    chunkId: "ch-1",
    noteId: "n-1",
    content: "texto",
    contactId: null,
    policyId: null,
    similarity: 0.61,
    sourceType: "text",
    createdAt: "2026-11-01T00:00:00Z",
    storagePath: null,
    fileName: null,
    ...overrides,
  };
}

function fakeRag(matches: NoteMatch[]) {
  const calls: Array<{ threshold: number; limit: number; options: unknown }> = [];
  const repo: IRagRepository = {
    searchNoteChunks: () => Promise.reject(new Error("no se usa")),
    searchNoteChunksText: () => Promise.reject(new Error("no se usa")),
    searchNoteChunksExact(_agentId, _embedding, threshold, limit, options) {
      calls.push({ threshold, limit, options });
      return Promise.resolve(matches);
    },
  };
  const provider = {
    model: "test",
    generateEmbedding: () => Promise.resolve({ embedding: [0.1, 0.2] }),
    generateEmbeddings: () => Promise.reject(new Error("no se usa")),
  } as unknown as IEmbeddingProvider;
  return { service: new RagService(repo, provider), calls };
}

Deno.test("RagService.searchHits: con contacto es búsqueda acotada (umbral 0.4)", async () => {
  const { service, calls } = fakeRag([noteMatch()]);
  const hits = await service.searchHits("agent-1", "su mamá", { contactId: "c-1", limit: 10 });
  assert.equal(calls[0].threshold, RAG_THRESHOLD_SCOPED);
  assert.equal(calls[0].limit, 10);
  assert.deepEqual(hits, [{ source: "note", id: "ch-1", rank: 1, score: 0.61, item: noteMatch() }]);
});

Deno.test("RagService.searchHits: sin entidad es la búsqueda amplia (umbral 0.5) con el limit default", async () => {
  const { service, calls } = fakeRag([]);
  await service.searchHits("agent-1", "currículum");
  assert.equal(calls[0].threshold, RAG_THRESHOLD_BROAD);
  assert.equal(calls[0].limit, 5);
});

Deno.test("ContactService.searchHits: score = similarity de search_contacts", async () => {
  const repo = {
    findSimilar: () => Promise.resolve([{ id: "c-1", full_name: "Rosa", similarity: 0.8 }]),
  } as unknown as ContactRepository;
  const hits = await new ContactService(repo).searchHits("agent-1", "rosa");
  assert.equal(hits.length, 1);
  assert.equal(hits[0].source, "contact");
  assert.equal(hits[0].id, "c-1");
  assert.equal(hits[0].rank, 1);
  assert.equal(hits[0].score, 0.8);
  assert.equal(hits[0].item.fullName, "Rosa");
});
