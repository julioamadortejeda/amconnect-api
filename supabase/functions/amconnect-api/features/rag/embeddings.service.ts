import type { IEmbeddingsRepository } from "./embeddings.repository.ts";
import type { IEmbeddingProvider } from "../../core/embedding_provider.interface.ts";
import { AppError } from "../../shared/errors.ts";
import { TextSplitter } from "../../shared/text_splitter.ts";

export type NoteSourceType = "pdf" | "image" | "audio" | "document" | "text" | "whatsapp";

export interface DocumentInput {
  content: string;
  sourceType: NoteSourceType;
  contactId?: string | null;
  policyId?: string | null;
  documentMetadataId?: string | null;
}

export interface SaveDocumentResult {
  noteId: string;
  embeddingTotalTokens: number;
  embeddingCount: number;
}

export class EmbeddingsService {
  constructor(
    private repository: IEmbeddingsRepository,
    private embeddingProvider: IEmbeddingProvider,
    private textSplitter: TextSplitter,
  ) {}

  async saveDocument(agentId: string, input: DocumentInput): Promise<SaveDocumentResult> {
    const noteId = await this.repository.insertNote({
      agentId,
      contactId: input.contactId ?? null,
      policyId: input.policyId ?? null,
      sourceType: input.sourceType,
      content: input.content,
      documentMetadataId: input.documentMetadataId ?? null,
    });

    const chunks = this.textSplitter.split(input.content);
    const { embeddings, totalTokens: embeddingTotalTokens } = await this.embeddingProvider.generateEmbeddings(chunks);

    if (embeddings.length !== chunks.length) {
      throw new AppError(
        `El proveedor devolvió ${embeddings.length} embeddings para ${chunks.length} chunks.`,
        500,
      );
    }

    const chunkRows = chunks.map((content, i) => ({
      noteId,
      agentId,
      chunkIndex: i,
      content,
      embedding: JSON.stringify(embeddings[i]),
    }));

    await this.repository.insertChunks(chunkRows);
    return { noteId, embeddingTotalTokens, embeddingCount: chunks.length };
  }

  async updateNoteLinks(
    agentId: string,
    documentMetadataId: string,
    contactId: string | null,
    policyId: string | null,
  ): Promise<void> {
    await this.repository.updateNoteLinks(agentId, documentMetadataId, contactId, policyId);
  }
}
