import { SupabaseClient } from "@supabase/supabase-js";
import { AppError } from "../../shared/errors.ts";

export interface InsertNoteData {
  agentId: string;
  contactId: string | null;
  policyId: string | null;
  sourceType: string;
  content: string;
  documentMetadataId: string | null;
}

export interface InsertChunkRow {
  noteId: string;
  agentId: string;
  chunkIndex: number;
  content: string;
  embedding: string;
}

export interface IEmbeddingsRepository {
  insertNote(data: InsertNoteData): Promise<string>;
  insertChunks(rows: InsertChunkRow[]): Promise<void>;
  updateNoteLinks(agentId: string, documentMetadataId: string, contactId: string | null, policyId: string | null): Promise<void>;
}

export class EmbeddingsRepository implements IEmbeddingsRepository {
  constructor(private supabase: SupabaseClient) {}

  async insertNote(data: InsertNoteData): Promise<string> {
    const { data: note, error } = await this.supabase
      .from("agent_notes")
      .insert({
        agent_id: data.agentId,
        contact_id: data.contactId,
        policy_id: data.policyId,
        source_type: data.sourceType,
        content: data.content,
        document_metadata_id: data.documentMetadataId,
      })
      .select("id")
      .single();

    if (error || !note) throw new AppError("No se pudo guardar la nota.", 500);
    return note.id;
  }

  async insertChunks(rows: InsertChunkRow[]): Promise<void> {
    await this.supabase.from("agent_note_chunks").insert(
      rows.map((r) => ({
        note_id: r.noteId,
        agent_id: r.agentId,
        chunk_index: r.chunkIndex,
        content: r.content,
        embedding: r.embedding,
      })),
    );
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
