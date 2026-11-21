// Contrato único de paginación: query `?page&pageSize` y respuesta
// `{ data, total, page, pageSize, hasMore }`.
import assert from "node:assert/strict";
import { buildPage, buildPageByLookahead, MAX_PAGE_SIZE, pageRange, PaginationQuerySchema } from "./pagination.ts";

Deno.test("PaginationQuerySchema: sin params → página 1 de 20", () => {
  assert.deepEqual(PaginationQuerySchema.parse({}), { page: 1, pageSize: 20 });
});

Deno.test("PaginationQuerySchema: convierte strings y recorta pageSize al tope", () => {
  assert.deepEqual(PaginationQuerySchema.parse({ page: "3", pageSize: "50" }), { page: 3, pageSize: 50 });
  assert.equal(PaginationQuerySchema.parse({ pageSize: "5000" }).pageSize, MAX_PAGE_SIZE);
});

Deno.test("PaginationQuerySchema: basura es error, no un default silencioso", () => {
  for (const bad of [{ page: "abc" }, { page: "0" }, { page: "-1" }, { page: "1.5" }, { pageSize: "0" }, { pageSize: "x" }, { page: "" }]) {
    assert.equal(PaginationQuerySchema.safeParse(bad).success, false, JSON.stringify(bad));
  }
});

Deno.test("pageRange: rango inclusivo base 0", () => {
  assert.deepEqual(pageRange(1, 20), { from: 0, to: 19 });
  assert.deepEqual(pageRange(3, 10), { from: 20, to: 29 });
});

Deno.test("buildPage: hasMore solo si quedan filas después de esta página", () => {
  assert.deepEqual(buildPage([1, 2], 5, 1, 2), { data: [1, 2], total: 5, page: 1, pageSize: 2, hasMore: true });
  assert.equal(buildPage([5], 5, 3, 2).hasMore, false);
  assert.equal(buildPage([3, 4], 4, 2, 2).hasMore, false, "página exacta al final");
  assert.deepEqual(buildPage([], 0, 1, 20), { data: [], total: 0, page: 1, pageSize: 20, hasMore: false });
});

Deno.test("buildPageByLookahead: la fila sobrante solo marca hasMore y no se devuelve; total se omite", () => {
  const page = buildPageByLookahead([1, 2, 3], 1, 2);
  assert.deepEqual(page, { data: [1, 2], page: 1, pageSize: 2, hasMore: true });
  assert.equal("total" in page, false);
  assert.equal(buildPageByLookahead([1, 2], 2, 2).hasMore, false);
});
