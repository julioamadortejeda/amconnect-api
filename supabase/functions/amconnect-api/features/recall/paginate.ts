/**
 * Cuántos elementos hay que pedirle a una fuente para poder paginar con
 * `moreAvailable` hasta la página `page` (el "límite + 1" de D-012). Las
 * fronteras de página las calcula `paginateWithBudget`.
 */
export function fetchSizeFor(page: number, limit: number): number {
  const p = Number.isInteger(page) && page >= 1 ? page : 1;
  return p * limit + 1;
}
