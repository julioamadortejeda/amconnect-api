import { SupabaseClient } from "@supabase/supabase-js";
import { handleSupabaseError } from "../../shared/errors.ts";

export interface InsertNoteData {
  agentId: string;
  contactId: string | null;
  policyId: string | null;
  reminderId?: string | null;
  sourceType: string;
  content: string;
  documentMetadataId: string | null;
  noteOrigin?: 'knowledge' | 'policy' | 'policy_changelog';
  summary?: string | null;
}

export interface InsertChunkRow {
  chunkIndex: number;
  content: string;
  embedding: number[];
}

export interface IEmbeddingsRepository {
  insertNoteWithChunks(data: InsertNoteData, chunks: InsertChunkRow[]): Promise<string>;
  updateNoteLinks(agentId: string, documentMetadataId: string, contactId: string | null, policyId: string | null): Promise<void>;
  softDeleteNotesByPolicy(agentId: string, policyId: string, origin: string): Promise<void>;
  softDeleteNoteById(agentId: string, noteId: string, discardReason: string): Promise<void>;
}

export class EmbeddingsRepository implements IEmbeddingsRepository {
  constructor(private supabase: SupabaseClient) {}

  // Nota + fragmentos en una sola transacción (función SQL). Antes eran dos
  // inserts separados y el de fragmentos no revisaba el error: si fallaba, la
  // nota quedaba guardada sin fragmentos y nunca aparecía en una búsqueda.
  async insertNoteWithChunks(data: InsertNoteData, chunks: InsertChunkRow[]): Promise<string> {
    const { data: noteId, error } = await this.supabase.rpc("insert_agent_note_with_chunks", {
      p_agent_id: data.agentId,
      p_contact_id: data.contactId,
      p_policy_id: data.policyId,
      p_reminder_id: data.reminderId ?? null,
      p_source_type: data.sourceType,
      p_content: data.content,
      p_document_metadata_id: data.documentMetadataId,
      p_note_origin: data.noteOrigin ?? 'knowledge',
      p_summary: data.summary ?? null,
      p_chunks: chunks.map((c) => ({
        chunk_index: c.chunkIndex,
        content: c.content,
        embedding: c.embedding,
      })),
    });

    if (error) handleSupabaseError(error, "Error al guardar la nota y sus fragmentos");
    return noteId as string;
  }

  async updateNoteLinks(
    agentId: string,
    documentMetadataId: string,
    contactId: string | null,
    policyId: string | null,
  ): Promise<void> {
    const { error } = await this.supabase
      .from("agent_notes")
      .update({ contact_id: contactId, policy_id: policyId })
      .eq("agent_id", agentId)
      .eq("document_metadata_id", documentMetadataId);

    if (error) handleSupabaseError(error, "Error al ligar la nota a la póliza");
  }

  async softDeleteNotesByPolicy(agentId: string, policyId: string, origin: string): Promise<void> {
    const { error } = await this.supabase
      .from("agent_notes")
      .update({ is_active: false, discard_reason: "policy_updated" })
      .eq("agent_id", agentId)
      .eq("policy_id", policyId)
      .eq("note_origin", origin)
      .eq("is_active", true);

    if (error) handleSupabaseError(error, "Error al desactivar las notas de la póliza");
  }

  async softDeleteNoteById(agentId: string, noteId: string, discardReason: string): Promise<void> {
    const { error } = await this.supabase
      .from("agent_notes")
      .update({ is_active: false, discard_reason: discardReason })
      .eq("agent_id", agentId)
      .eq("id", noteId)
      .eq("is_active", true);

    if (error) handleSupabaseError(error, "Error al desactivar la nota");
  }
}
