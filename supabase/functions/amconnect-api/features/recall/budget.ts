export interface BudgetResult<T> {
  groups: Record<string, T[]>;
  /** Elementos recortados por tamaño, por grupo (solo grupos con recorte). */
  omitted: Record<string, number>;
}

export function countWords(text: string): number {
  const t = text.trim();
  return t === "" ? 0 : t.split(/\s+/).length;
}

/**
 * Recorta los grupos para que el total no pase de `maxWords`. Reparte en
 * rondas (el 1º de cada grupo, luego el 2º, ...) para que ningún grupo se quede
 * sin representación por culpa de otro grande; dentro de un grupo se conserva
 * siempre un PREFIJO (nunca se salta un elemento). Al primer elemento que no
 * cabe se corta todo. Siempre entra al menos un elemento si hay alguno, para no
 * devolver vacío por un solo elemento enorme. Pura, sin I/O.
 */
export function applyBudget<T>(
  groups: Record<string, T[]>,
  maxWords: number,
  wordsOf: (item: T) => number,
): BudgetResult<T> {
  const names = Object.keys(groups);
  const kept: Record<string, T[]> = Object.fromEntries(names.map((n) => [n, []]));
  const longest = Math.max(0, ...names.map((n) => groups[n].length));
  let used = 0;
  let stopped = false;

  for (let round = 0; round < longest && !stopped; round++) {
    for (const name of names) {
      const item = groups[name][round];
      if (item === undefined) continue;
      const w = wordsOf(item);
      const keptAny = used > 0 || names.some((n) => kept[n].length > 0);
      if (keptAny && used + w > maxWords) {
        stopped = true;
        break;
      }
      kept[name].push(item);
      used += w;
    }
  }

  const omitted: Record<string, number> = {};
  for (const name of names) {
    const dropped = groups[name].length - kept[name].length;
    if (dropped > 0) omitted[name] = dropped;
  }
  return { groups: kept, omitted };
}
