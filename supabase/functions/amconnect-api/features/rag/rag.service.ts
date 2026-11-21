import type { IRagRepository, NoteMatch } from "./rag.repository.ts";
import type { IEmbeddingProvider } from "../../core/embedding_provider.interface.ts";
import { type Searchable, type SearchHit, type SearchOptions, toSearchHits } from "../../shared/search_hits.ts";

export type { NoteMatch };

/**
 * Umbrales de similitud del RAG (RULES §5).
 *
 * Acotada (con contacto, póliza o recordatorio): 0.4. El filtro va dentro de la
 * función SQL (20261120235540), así que ya no se puede colar la nota de otro
 * cliente, que era la razón del 0.65 de agosto. Medido el 2026-11-20 con
 * gemini-embedding-2: "¿Qué me dijo Rosa de su mamá?" contra una nota que dice
 * exactamente eso da 0.61, y "familia" 0.53; con 0.65 el asistente respondía
 * que no había nada.
 * Sin entidad en una skill acotada (el modelo omitió el id): 0.65, como antes.
 */
export const RAG_THRESHOLD_SCOPED = 0.4;
export const RAG_THRESHOLD_ENTITY_UNSCOPED = 0.65;
/**
 * Búsqueda amplia sin entidad (`search_knowledge`, último recurso de la
 * cascada BD → RAG → notas): más permisiva a propósito, ver RULES §5.
 */
export const RAG_THRESHOLD_BROAD = 0.5;

export function entityThreshold(entityId: string | undefined): number {
  return entityId ? RAG_THRESHOLD_SCOPED : RAG_THRESHOLD_ENTITY_UNSCOPED;
}

export class RagService implements Searchable<NoteMatch> {
  constructor(
    private repository: IRagRepository,
    private embeddingProvider: IEmbeddingProvider,
  ) {}

  async searchNotes(
    agentId: string,
    query: string,
    options?: { contactId?: string; policyId?: string; reminderId?: string; threshold?: number; limit?: number },
  ): Promise<NoteMatch[]> {
    const { embedding } = await this.embeddingProvider.generateEmbedding(query);

    return await this.repository.searchNoteChunks(
      agentId,
      JSON.stringify(embedding),
      options?.threshold ?? 0.7,
      options?.limit ?? 5,
      { contactId: options?.contactId, policyId: options?.policyId, reminderId: options?.reminderId },
    );
  }

  /** Embedding de la consulta (una sola llamada al proveedor). */
  async embedQuery(query: string): Promise<number[]> {
    const { embedding } = await this.embeddingProvider.generateEmbedding(query);
    return embedding;
  }

  /**
   * Fuente "note" de `recall` (ver shared/search_hits.ts), parte VECTORIAL.
   * Búsqueda EXACTA con orden estable (similitud y luego id), para que la
   * página 2 no repita la 1. Con contacto, póliza o recordatorio es ACOTADA
   * (`RAG_THRESHOLD_SCOPED`); sin ninguno es la amplia (`RAG_THRESHOLD_BROAD`).
   * Un hit por fragmento: `id` es el `chunkId` y la nota está en `item.noteId`;
   * `score` es la similitud coseno.
   */
  async searchHits(agentId: string, query: string, opts: SearchOptions = {}): Promise<SearchHit<NoteMatch>[]> {
    const scoped = !!(opts.contactId || opts.policyId || opts.reminderId || opts.noteId);
    const embedding = opts.queryEmbedding ?? await this.embedQuery(query);
    const matches = await this.repository.searchNoteChunksExact(
      agentId,
      JSON.stringify(embedding),
      scoped ? RAG_THRESHOLD_SCOPED : RAG_THRESHOLD_BROAD,
      opts.limit ?? 5,
      { contactId: opts.contactId, policyId: opts.policyId, reminderId: opts.reminderId, sourceTypes: opts.sourceTypes, noteId: opts.noteId },
    );
    return toSearchHits("note", matches, (m) => m.chunkId, { scoreOf: (m) => m.similarity });
  }

  /**
   * Misma fuente, parte de TEXTO COMPLETO: encuentra términos exactos que el
   * vector diluye ("hernia", números de póliza, nombres de aseguradora). El
   * `score` es la relevancia léxica y no se compara con el de `searchHits`;
   * se combinan por posición (RRF) fuera de aquí.
   */
  async searchTextHits(agentId: string, query: string, opts: SearchOptions = {}): Promise<SearchHit<NoteMatch>[]> {
    const matches = await this.repository.searchNoteChunksText(agentId, query, opts.limit ?? 5, {
      contactId: opts.contactId,
      policyId: opts.policyId,
      reminderId: opts.reminderId,
      sourceTypes: opts.sourceTypes,
      noteId: opts.noteId,
    });
    return toSearchHits("note", matches, (m) => m.chunkId, { scoreOf: (m) => m.similarity });
  }

  formatContextForPrompt(notes: NoteMatch[]): string {
    if (notes.length === 0) return "";
    return notes.map((n, i) => `[Nota ${i + 1}]: ${n.content}`).join("\n");
  }
}
