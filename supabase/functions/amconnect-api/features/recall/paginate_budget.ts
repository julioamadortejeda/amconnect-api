import { applyBudget } from "./budget.ts";

export interface BudgetedPage<T> {
  items: T[];
  /** true si queda algo después de esta página: lo recortado por tamaño o por el límite. */
  moreAvailable: boolean;
}

/**
 * Página `page` (1-based) de varios grupos a la vez, con límite por grupo Y
 * presupuesto de palabras por página. Lo que no cabe en la página N es lo
 * primero de la N+1: las fronteras se calculan simulando las páginas 1..N desde
 * el inicio, cada grupo con su propio cursor, así que las mismas entradas dan
 * siempre las mismas fronteras (nada se pierde ni se repite).
 *
 * Cada página toma hasta `limit` elementos por grupo (la ventana desde el
 * cursor) y la recorta con `applyBudget` (rondas entre grupos, prefijo por
 * grupo; siempre entra al menos un elemento, así que toda página avanza).
 * `items` de cada grupo debe traer al menos `page * limit + 1` elementos si los
 * hay, para que `moreAvailable` sea fiable. Pura, sin I/O.
 */
export function paginateWithBudget<T>(
  groups: Record<string, T[]>,
  page: number,
  limit: number,
  maxWords: number,
  wordsOf: (group: string, item: T) => number,
): Record<string, BudgetedPage<T>> {
  const p = Number.isInteger(page) && page >= 1 ? page : 1;
  const names = Object.keys(groups);
  const cursor: Record<string, number> = Object.fromEntries(names.map((n) => [n, 0]));
  let kept: Record<string, T[]> = {};

  for (let current = 1; current <= p; current++) {
    const windows = Object.fromEntries(names.map((n) => [n, groups[n].slice(cursor[n], cursor[n] + limit)]));
    // El peso depende del grupo: se envuelve cada elemento con el suyo.
    const tagged = Object.fromEntries(
      names.map((n) => [n, windows[n].map((item) => ({ group: n, item }))]),
    );
    const result = applyBudget(tagged, maxWords, (t) => wordsOf(t.group, t.item));
    kept = Object.fromEntries(names.map((n) => [n, result.groups[n].map((t) => t.item)]));
    if (current < p) for (const n of names) cursor[n] += kept[n].length;
  }

  return Object.fromEntries(
    names.map((n) => [n, {
      items: kept[n],
      moreAvailable: groups[n].length > cursor[n] + kept[n].length,
    }]),
  );
}
