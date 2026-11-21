import type { IRecallSearchRepository } from "./recall_search.repository.ts";
import { RECALL_SEARCH_TTL_MINUTES } from "./recall.config.ts";

export interface ResolvedSearch {
  searchId: string;
  embedding: number[];
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export const normalizeQuery = (q: string): string => q.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * Embedding de la consulta de `recall`, calculado UNA vez y reutilizado en las
 * páginas siguientes (mismo vector => mismo orden). `embed` es quien llama al
 * proveedor; este service solo decide si hace falta.
 */
export class RecallSearchService {
  constructor(
    private repository: IRecallSearchRepository,
    private embed: (query: string) => Promise<number[]>,
    private now: () => Date = () => new Date(),
  ) {}

  /**
   * Con `searchId` vigente, del mismo asesor y de la misma consulta: reutiliza el
   * vector guardado. En cualquier otro caso (falta, venció, es de otro asesor o la
   * consulta cambió) calcula uno nuevo y devuelve un `searchId` nuevo. Nunca falla
   * por un `searchId` inservible.
   */
  async resolve(agentId: string, query: string, searchId?: string): Promise<ResolvedSearch> {
    const now = this.now();
    const cutoff = new Date(now.getTime() - RECALL_SEARCH_TTL_MINUTES * 60_000);

    if (searchId && UUID_RE.test(searchId)) {
      const stored = await this.repository.findValid(agentId, searchId, cutoff);
      if (stored && normalizeQuery(stored.query) === normalizeQuery(query)) {
        return { searchId: stored.id, embedding: stored.embedding };
      }
    }

    const embedding = await this.embed(query);
    // Limpieza barata: cada asesor solo conserva lo de su última media hora.
    await this.repository.deleteExpired(agentId, cutoff);
    const id = await this.repository.insert(agentId, query, embedding);
    return { searchId: id, embedding };
  }
}
