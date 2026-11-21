import type { IRagRepository, NoteMatch } from "./rag.repository.ts";
import type { IEmbeddingProvider } from "../../core/embedding_provider.interface.ts";

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

export function entityThreshold(entityId: string | undefined): number {
  return entityId ? RAG_THRESHOLD_SCOPED : RAG_THRESHOLD_ENTITY_UNSCOPED;
}

export class RagService {
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

  formatContextForPrompt(notes: NoteMatch[]): string {
    if (notes.length === 0) return "";
    return notes.map((n, i) => `[Nota ${i + 1}]: ${n.content}`).join("\n");
  }
}
