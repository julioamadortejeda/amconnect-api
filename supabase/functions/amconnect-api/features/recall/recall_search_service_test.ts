import assert from "node:assert/strict";
import { RecallSearchService } from "./recall_search.service.ts";
import type { IRecallSearchRepository, StoredSearch } from "./recall_search.repository.ts";
import { RECALL_SEARCH_TTL_MINUTES } from "./recall.config.ts";

const ID = "3f1c2a8e-5b7d-4e19-9a0c-2d6f8b1e4c37";

function setup(stored: StoredSearch | null) {
  const log: string[] = [];
  let embeds = 0;
  const repo: IRecallSearchRepository = {
    findValid: (agent, id, notBefore) => {
      log.push(`find:${agent}:${id}:${notBefore.toISOString()}`);
      return Promise.resolve(stored);
    },
    insert: (_a, q) => {
      log.push(`insert:${q}`);
      return Promise.resolve("new-id");
    },
    deleteExpired: () => {
      log.push("delete");
      return Promise.resolve();
    },
  };
  const now = new Date("2026-11-21T12:00:00Z");
  const svc = new RecallSearchService(repo, () => {
    embeds++;
    return Promise.resolve([9, 9]);
  }, () => now);
  return { svc, log, embeds: () => embeds };
}

Deno.test("resolve: sin searchId calcula, limpia vencidas y guarda", async () => {
  const { svc, log, embeds } = setup(null);
  const r = await svc.resolve("a1", "hernia");
  assert.deepEqual(r, { searchId: "new-id", embedding: [9, 9] });
  assert.equal(embeds(), 1);
  assert.deepEqual(log, ["delete", "insert:hernia"]);
});

Deno.test("resolve: searchId vigente y misma consulta reutiliza el vector sin llamar al proveedor", async () => {
  const { svc, log, embeds } = setup({ id: ID, query: "Hernia ", embedding: [1, 2] });
  const r = await svc.resolve("a1", "  hernia", ID);
  assert.deepEqual(r, { searchId: ID, embedding: [1, 2] });
  assert.equal(embeds(), 0);
  // el corte de vigencia es now - TTL
  assert.ok(log[0].endsWith(new Date(Date.parse("2026-11-21T12:00:00Z") - RECALL_SEARCH_TTL_MINUTES * 60_000).toISOString()));
});

Deno.test("resolve: searchId vencido, ajeno o inexistente (la BD no lo devuelve) recalcula y nunca falla", async () => {
  const { svc, embeds } = setup(null);
  const r = await svc.resolve("a1", "hernia", ID);
  assert.equal(r.searchId, "new-id");
  assert.equal(embeds(), 1);
});

Deno.test("resolve: searchId con otra consulta recalcula", async () => {
  const { svc, embeds } = setup({ id: ID, query: "otra cosa", embedding: [1, 2] });
  await svc.resolve("a1", "hernia", ID);
  assert.equal(embeds(), 1);
});

Deno.test("resolve: searchId que no es UUID se ignora sin consultar la BD", async () => {
  const { svc, log } = setup(null);
  await svc.resolve("a1", "hernia", "no-es-uuid");
  assert.ok(!log.some((l) => l.startsWith("find")));
});
