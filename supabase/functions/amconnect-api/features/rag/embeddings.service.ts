import { SupabaseClient } from "@supabase/supabase-js";
import { IEmbeddingProvider } from "../../core/embedding_provider.interface.ts";
import { AppError } from "../../shared/errors.ts";

export type NoteSourceType = "pdf" | "image" | "audio" | "document" | "text";

export interface DocumentInput {
  aiContent: string;
  sourceType: NoteSourceType;
  contactId?: string | null;
  policyId?: string | null;
  documentMetadataId?: string | null;
  metadata?: Record<string, unknown>;
}

export class EmbeddingsService {
  private readonly CHUNK_SIZE = 800;
  private readonly CHUNK_OVERLAP = 150;
  private readonly MIN_CHUNK_SIZE = 80;

  constructor(
    private supabase: SupabaseClient,
    private embeddingProvider: IEmbeddingProvider,
  ) {}

  async saveDocument(agentId: string, input: DocumentInput): Promise<string> {
    const { data: note, error } = await this.supabase
      .from("agent_notes")
      .insert({
        agent_id: agentId,
        contact_id: input.contactId ?? null,
        policy_id: input.policyId ?? null,
        source_type: input.sourceType,
        ai_content: input.aiContent,
        document_metadata_id: input.documentMetadataId ?? null,
        metadata: input.metadata ?? null,
      })
      .select("id")
      .single();

    if (error || !note) throw new AppError("No se pudo guardar la nota.", 500);

    const chunks = this.chunkText(input.aiContent);
    const chunkRows = await Promise.all(
      chunks.map(async (content, i) => ({
        note_id: note.id,
        agent_id: agentId,
        chunk_index: i,
        content,
        embedding: JSON.stringify(await this.embeddingProvider.generateEmbedding(content)),
      })),
    );

    await this.supabase.from("agent_note_chunks").insert(chunkRows);
    return note.id;
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

  private chunkText(text: string): string[] {
    if (!text) return [""];
    if (text.length <= this.CHUNK_SIZE) return [text];

    const chunks: string[] = [];
    let start = 0;

    while (start < text.length) {
      const end = Math.min(start + this.CHUNK_SIZE, text.length);
      const chunk = text.slice(start, end);
      if (chunk.length >= this.MIN_CHUNK_SIZE) chunks.push(chunk);
      if (end === text.length) break;
      start = end - this.CHUNK_OVERLAP;
    }

    return chunks.length > 0 ? chunks : [text];
  }
}
