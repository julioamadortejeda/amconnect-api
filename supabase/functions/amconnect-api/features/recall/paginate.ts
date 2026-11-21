export interface Page<T> {
  items: T[];
  /** true si hay al menos un elemento después de esta página. */
  moreAvailable: boolean;
}

/**
 * Página `page` (1-based) de `limit` elementos. `moreAvailable` sale de que la
 * entrada traiga al menos un elemento más allá de la página: por eso quien
 * consulta la fuente pide `page * limit + 1` (el "límite + 1" de D-012).
 * Una página inválida (< 1, no entera) se toma como 1. Pura, sin I/O.
 */
export function paginate<T>(items: T[], page: number, limit: number): Page<T> {
  const p = Number.isInteger(page) && page >= 1 ? page : 1;
  const start = (p - 1) * limit;
  return {
    items: items.slice(start, start + limit),
    moreAvailable: items.length > start + limit,
  };
}

/** Cuántos elementos hay que pedirle a la fuente para poder paginar con `moreAvailable`. */
export function fetchSizeFor(page: number, limit: number): number {
  const p = Number.isInteger(page) && page >= 1 ? page : 1;
  return p * limit + 1;
}
