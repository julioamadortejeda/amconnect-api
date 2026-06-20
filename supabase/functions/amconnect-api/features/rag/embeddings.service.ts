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
  noteOrigin?: 'knowledge' | 'policy' | 'policy_changelog';
  summary?: string | null;
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
      noteOrigin: input.noteOrigin ?? 'knowledge',
      summary: input.summary ?? null,
    });

    const chunks = this.textSplitter.split(input.content);
    const textsToEmbed = input.summary
      ? [...chunks, input.summary]
      : chunks;

    const { embeddings, totalTokens: embeddingTotalTokens } = await this.embeddingProvider.generateEmbeddings(textsToEmbed);

    if (embeddings.length !== textsToEmbed.length) {
      throw new AppError(
        `El proveedor devolvió ${embeddings.length} embeddings para ${textsToEmbed.length} chunks.`,
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

    if (input.summary) {
      chunkRows.push({
        noteId,
        agentId,
        chunkIndex: chunks.length,
        content: input.summary,
        embedding: JSON.stringify(embeddings[chunks.length]),
      });
    }

    await this.repository.insertChunks(chunkRows);
    return { noteId, embeddingTotalTokens, embeddingCount: textsToEmbed.length };
  }

  async updateNoteLinks(
    agentId: string,
    documentMetadataId: string,
    contactId: string | null,
    policyId: string | null,
  ): Promise<void> {
    await this.repository.updateNoteLinks(agentId, documentMetadataId, contactId, policyId);
  }

  async softDeleteNotesByPolicy(agentId: string, policyId: string, origin: string): Promise<void> {
    await this.repository.softDeleteNotesByPolicy(agentId, policyId, origin);
  }

  async softDeleteNoteById(agentId: string, noteId: string, discardReason: string): Promise<void> {
    await this.repository.softDeleteNoteById(agentId, noteId, discardReason);
  }

  get embeddingModelName(): string {
    return this.embeddingProvider.model;
  }
}
