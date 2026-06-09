import type { IRagRepository, NoteMatch } from "./rag.repository.ts";
import type { IEmbeddingProvider } from "../../core/embedding_provider.interface.ts";

export type { NoteMatch };

export class RagService {
  constructor(
    private repository: IRagRepository,
    private embeddingProvider: IEmbeddingProvider,
  ) {}

  async searchNotes(
    agentId: string,
    query: string,
    options?: { contactId?: string; policyId?: string; threshold?: number; limit?: number },
  ): Promise<NoteMatch[]> {
    const { embedding } = await this.embeddingProvider.generateEmbedding(query);

    return await this.repository.searchNoteChunks(
      agentId,
      JSON.stringify(embedding),
      options?.threshold ?? 0.7,
      options?.limit ?? 5,
      { contactId: options?.contactId, policyId: options?.policyId },
    );
  }

  formatContextForPrompt(notes: NoteMatch[]): string {
    if (notes.length === 0) return "";
    return notes.map((n, i) => `[Nota ${i + 1}]: ${n.content}`).join("\n");
  }
}
