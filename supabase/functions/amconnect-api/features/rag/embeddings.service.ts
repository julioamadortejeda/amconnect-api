import { SupabaseClient } from "@supabase/supabase-js";
import { IEmbeddingProvider } from "../../core/embedding_provider.interface.ts";
import { AppError } from "../../shared/errors.ts";
import { TextSplitter } from "../../shared/text_splitter.ts";

export type NoteSourceType = "pdf" | "image" | "audio" | "document" | "text";

export interface DocumentInput {
  content: string;
  sourceType: NoteSourceType;
  contactId?: string | null;
  policyId?: string | null;
  documentMetadataId?: string | null;
  metadata?: Record<string, unknown>;
}

export interface SaveDocumentResult {
  noteId: string;
  embeddingTotalTokens: number;
  embeddingCount: number;
}

export class EmbeddingsService {
  constructor(
    private supabase: SupabaseClient,
    private embeddingProvider: IEmbeddingProvider,
    private textSplitter: TextSplitter,
  ) {}

  async saveDocument(agentId: string, input: DocumentInput): Promise<SaveDocumentResult> {
    const { data: note, error } = await this.supabase
      .from("agent_notes")
      .insert({
        agent_id: agentId,
        contact_id: input.contactId ?? null,
        policy_id: input.policyId ?? null,
        source_type: input.sourceType,
        content: input.content,
        document_metadata_id: input.documentMetadataId ?? null,
        metadata: input.metadata ?? null,
      })
      .select("id")
      .single();

    if (error || !note) throw new AppError("No se pudo guardar la nota.", 500);

    const chunks = this.textSplitter.split(input.content);
    const { embeddings, totalTokens: embeddingTotalTokens } = await this.embeddingProvider.generateEmbeddings(chunks);

    if (embeddings.length !== chunks.length) {
      throw new AppError(
        `El proveedor devolvió ${embeddings.length} embeddings para ${chunks.length} chunks.`,
        500,
      );
    }

    const chunkRows = chunks.map((content, i) => ({
      note_id: note.id,
      agent_id: agentId,
      chunk_index: i,
      content,
      embedding: JSON.stringify(embeddings[i]),
    }));

    await this.supabase.from("agent_note_chunks").insert(chunkRows);

    return { noteId: note.id, embeddingTotalTokens, embeddingCount: chunks.length };
  }

  async updateNoteLinks(
    agentId: string,
    documentMetadataId: string,
    contactId: string | null,
    policyId: string | null,
  ): Promise<void> {
    await this.supabase
      .from("agent_notes")
      .update({ contact_id: contactId, policy_id: policyId })
      .eq("agent_id", agentId)
      .eq("document_metadata_id", documentMetadataId);
  }
}
