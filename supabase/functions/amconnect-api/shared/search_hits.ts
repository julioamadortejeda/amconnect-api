/**
 * Contrato común de búsqueda para `recall` (D-013): una sola skill de solo
 * lectura que consulta EN PARALELO contactos, pólizas, recordatorios,
 * compromisos y notas, y combina las fuentes por POSICIÓN (RRF), no por
 * puntaje — el trigram de contactos y el coseno del RAG no se pueden comparar.
 *
 * Cada service expone `searchHits(agentId, query, opts)` con esta firma:
 *   ContactService, PolicyService, ReminderService, CommitmentService, RagService.
 *
 * Reglas del contrato:
 * - `rank` es 1-based y es el orden que ya decide la fuente (relevancia en
 *   contactos/pólizas/notas; fecha en recordatorios y compromisos, que no
 *   tienen puntaje). Es lo único que RRF necesita.
 * - `score` solo cuando la fuente tiene uno nativo; nunca se compara entre
 *   fuentes.
 * - `item` es el DTO de dominio tal cual: ni texto para el modelo ni recorte.
 *   El recorte lo hace quien arma la respuesta (el mapper de la skill).
 * - Un fallo de BD lanza; nunca se devuelve `[]` por error (el modelo lo leería
 *   como "no hay nada").
 */
export type SearchSource = "contact" | "policy" | "reminder" | "commitment" | "note";

export interface SearchHit<T> {
  source: SearchSource;
  id: string;
  rank: number;
  score?: number;
  item: T;
}

export interface SearchOptions {
  /** Tope de resultados de ESTA fuente. Sin él, lo que la fuente devuelva. */
  limit?: number;
  /** Acota a un cliente. Las fuentes que no lo soportan lo ignoran (contactos). */
  contactId?: string;
  /** Solo notas: acota a una póliza o a un recordatorio. */
  policyId?: string;
  reminderId?: string;
}

export interface Searchable<T> {
  searchHits(agentId: string, query: string, opts?: SearchOptions): Promise<SearchHit<T>[]>;
}

/** Convierte una lista ya ordenada por la fuente en hits con `rank`. */
export function toSearchHits<T>(
  source: SearchSource,
  items: T[],
  idOf: (item: T) => string,
  opts: { limit?: number; scoreOf?: (item: T) => number | undefined } = {},
): SearchHit<T>[] {
  const limited = opts.limit !== undefined ? items.slice(0, opts.limit) : items;
  return limited.map((item, i) => {
    const score = opts.scoreOf?.(item);
    return {
      source,
      id: idOf(item),
      rank: i + 1,
      ...(typeof score === "number" ? { score } : {}),
      item,
    };
  });
}
