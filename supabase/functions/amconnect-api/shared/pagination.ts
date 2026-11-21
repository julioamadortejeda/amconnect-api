import { z } from "zod";
import type { PaginatedResult } from "../core/repository.interface.ts";

export const DEFAULT_PAGE_SIZE = 20;
export const MAX_PAGE_SIZE = 100;

/**
 * Query params de TODO listado paginado: `?page=1&pageSize=20`.
 *
 * Los dos son opcionales (sin ellos: página 1 de 20). `pageSize` por encima del
 * tope se recorta a `MAX_PAGE_SIZE` en vez de rechazarse; un valor que no es
 * número o es menor a 1 sí es 422 — antes se tragaba en silencio.
 */
export const PaginationQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).transform((n) => Math.min(n, MAX_PAGE_SIZE)).default(DEFAULT_PAGE_SIZE),
});

export type PaginationQuery = z.infer<typeof PaginationQuerySchema>;

/** Rango (inclusivo, base 0) de filas de una página, listo para `.range(from, to)`. */
export function pageRange(page: number, pageSize: number): { from: number; to: number } {
  const from = (page - 1) * pageSize;
  return { from, to: from + pageSize - 1 };
}

/**
 * Forma única de un listado paginado. Es la misma que arma
 * `SupabaseRepository.paginate`; cualquier listado nuevo la construye aquí.
 */
export function buildPage<T>(data: T[], total: number, page: number, pageSize: number): PaginatedResult<T> {
  return { data, total, page, pageSize, hasMore: (page - 1) * pageSize + pageSize < total };
}

/**
 * Para fuentes que no pueden contar (una función SQL sin `count`): se piden
 * `pageSize + 1` filas y la sobrante solo dice si hay otra página. En ese caso
 * `total` se omite — no se inventa.
 */
export function buildPageByLookahead<T>(rows: T[], page: number, pageSize: number): PaginatedResult<T> {
  return { data: rows.slice(0, pageSize), page, pageSize, hasMore: rows.length > pageSize };
}
