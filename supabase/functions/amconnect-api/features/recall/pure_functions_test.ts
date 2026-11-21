import assert from "node:assert/strict";
import { rrfMerge } from "./rrf.ts";
import { capPerDocument } from "./cap_per_document.ts";
import { fetchSizeFor } from "./paginate.ts";
import { paginateWithBudget } from "./paginate_budget.ts";
import { applyBudget, countWords } from "./budget.ts";
import type { SearchHit } from "../../shared/search_hits.ts";

const hit = (id: string, rank: number): SearchHit<string> => ({ source: "note", id, rank, item: id });

Deno.test("rrfMerge: un hit en las dos listas sube sobre uno que solo está en una", () => {
  const vec = [hit("a", 1), hit("b", 2), hit("c", 3)];
  const txt = [hit("c", 1), hit("d", 2)];
  const merged = rrfMerge([vec, txt]);
  assert.deepEqual(merged.map((h) => h.id), ["c", "a", "b", "d"]);
  assert.deepEqual(merged.map((h) => h.rank), [1, 2, 3, 4]);
});

Deno.test("rrfMerge: desempata por id y es estable", () => {
  const merged = rrfMerge([[hit("b", 1)], [hit("a", 1)]]);
  assert.deepEqual(merged.map((h) => h.id), ["a", "b"]);
  assert.deepEqual(rrfMerge([[hit("b", 1)], [hit("a", 1)]]), merged);
});

Deno.test("rrfMerge: listas vacías", () => {
  assert.deepEqual(rrfMerge([[], []]), []);
});

Deno.test("capPerDocument: tope por documento, marca moreInDocument y ordena por mejor fragmento", () => {
  const hits = [
    { id: 1, doc: "A" }, { id: 2, doc: "A" }, { id: 3, doc: "B" }, { id: 4, doc: "A" }, { id: 5, doc: "B" },
  ];
  const out = capPerDocument(hits, (h) => h.doc, 2);
  assert.deepEqual(out.map((d) => d.documentId), ["A", "B"]);
  assert.deepEqual(out[0].hits.map((h) => h.id), [1, 2]);
  assert.equal(out[0].moreInDocument, true);
  assert.deepEqual(out[1].hits.map((h) => h.id), [3, 5]);
  assert.equal(out[1].moreInDocument, false);
});

Deno.test("fetchSizeFor: pide límite + 1; página inválida es la 1", () => {
  assert.equal(fetchSizeFor(1, 10), 11);
  assert.equal(fetchSizeFor(3, 10), 31);
  assert.equal(fetchSizeFor(0, 10), 11);
});

Deno.test("applyBudget: sin recorte cuando cabe todo", () => {
  const r = applyBudget({ a: ["x y", "z"], b: ["w"] }, 100, countWords);
  assert.deepEqual(r.groups, { a: ["x y", "z"], b: ["w"] });
  assert.deepEqual(r.omitted, {});
});

Deno.test("applyBudget: reparte en rondas, conserva prefijos y reporta lo omitido", () => {
  const big = "p q r s";            // 4 palabras
  const r = applyBudget({ a: [big, big, big], b: [big, big] }, 9, countWords);
  // ronda 1: a0 (4), b0 (8); ronda 2: a1 (12) no cabe -> corta todo
  assert.deepEqual(r.groups, { a: [big], b: [big] });
  assert.deepEqual(r.omitted, { a: 2, b: 1 });
});

Deno.test("applyBudget: siempre entra un elemento aunque exceda el presupuesto", () => {
  const r = applyBudget({ a: ["uno dos tres cuatro cinco"] }, 2, countWords);
  assert.equal(r.groups.a.length, 1);
});

Deno.test("applyBudget: grupos vacíos", () => {
  assert.deepEqual(applyBudget({ a: [], b: [] }, 10, countWords), { groups: { a: [], b: [] }, omitted: {} });
});

const words = (_g: string, item: string) => countWords(item);

Deno.test("paginateWithBudget: sin presupuesto que estorbe pagina por límite con moreAvailable", () => {
  const g = { a: ["1", "2", "3", "4", "5"] };
  assert.deepEqual(paginateWithBudget(g, 1, 2, 100, words), { a: { items: ["1", "2"], moreAvailable: true } });
  assert.deepEqual(paginateWithBudget(g, 3, 2, 100, words), { a: { items: ["5"], moreAvailable: false } });
  assert.deepEqual(paginateWithBudget(g, 4, 2, 100, words), { a: { items: [], moreAvailable: false } });
  assert.deepEqual(paginateWithBudget(g, 0, 2, 100, words).a.items, ["1", "2"]);
});

Deno.test("paginateWithBudget: lo recortado por tamaño abre la página siguiente, sin perder ni repetir", () => {
  const big = "p q r s"; // 4 palabras
  const items = ["a", "b", "c", "d", "e", "f"].map((x) => `${big} ${x}`); // 5 palabras c/u
  const seen: string[] = [];
  for (let page = 1; page <= 6; page++) {
    const r = paginateWithBudget({ g: items }, page, 10, 12, words).g; // caben 2 por página
    assert.ok(r.items.length <= 2);
    seen.push(...r.items);
    assert.equal(r.moreAvailable, seen.length < items.length);
  }
  assert.deepEqual(seen, items);
});

Deno.test("paginateWithBudget: es determinista y avanza aunque un elemento exceda el presupuesto", () => {
  const items = ["uno dos tres cuatro cinco seis", "x"];
  const p1 = paginateWithBudget({ g: items }, 1, 10, 2, words);
  assert.deepEqual(p1.g, { items: [items[0]], moreAvailable: true });
  assert.deepEqual(paginateWithBudget({ g: items }, 1, 10, 2, words), p1);
  assert.deepEqual(paginateWithBudget({ g: items }, 2, 10, 2, words).g, { items: ["x"], moreAvailable: false });
});

Deno.test("paginateWithBudget: varios grupos, cada uno con su cursor", () => {
  const big = "p q r s";
  const g = { a: [big, big, big], b: [big, big] };
  const p1 = paginateWithBudget(g, 1, 10, 9, words);
  assert.deepEqual([p1.a.items.length, p1.b.items.length], [1, 1]);
  assert.equal(p1.a.moreAvailable && p1.b.moreAvailable, true);
  const p2 = paginateWithBudget(g, 2, 10, 9, words);
  assert.deepEqual([p2.a.items.length, p2.b.items.length], [1, 1]);
});
