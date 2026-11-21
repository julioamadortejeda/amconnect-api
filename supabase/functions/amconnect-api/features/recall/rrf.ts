import { RRF_K } from "./recall.config.ts";
import type { SearchHit } from "../../shared/search_hits.ts";

/**
 * Reciprocal Rank Fusion: combina listas ya ordenadas por POSICIÓN, no por
 * puntaje (el coseno y el ts_rank no se pueden comparar). Cada hit suma
 * 1 / (k + rank) por cada lista donde aparece; un hit en las dos listas sube.
 * Desempata por `id` para que el orden sea estable. Devuelve los hits con `rank`
 * 1-based nuevo y `score` = puntaje RRF. Pura, sin I/O.
 */
export function rrfMerge<T>(lists: SearchHit<T>[][], k = RRF_K): SearchHit<T>[] {
  const acc = new Map<string, { hit: SearchHit<T>; score: number }>();
  for (const list of lists) {
    list.forEach((hit, i) => {
      const position = i + 1; // se usa la posición real, no el rank que traiga el hit
      const add = 1 / (k + position);
      const prev = acc.get(hit.id);
      if (prev) prev.score += add;
      else acc.set(hit.id, { hit, score: add });
    });
  }
  return [...acc.values()]
    .sort((a, b) => b.score - a.score || (a.hit.id < b.hit.id ? -1 : a.hit.id > b.hit.id ? 1 : 0))
    .map((e, i) => ({ ...e.hit, rank: i + 1, score: e.score }));
}
