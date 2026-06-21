import { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseRepository } from "../../core/base_repository.ts";
import { handleSupabaseError } from "../../shared/errors.ts";
import { NoteResponseDTO, PolicyNoteRow, RecentNoteRow } from "./note.dto.ts";

export type { NoteResponseDTO, PolicyNoteRow, RecentNoteRow };

const NOTE_SELECT = `
  id, contact_id, policy_id, source_type, content, summary, note_origin, created_at,
  document_metadata(storage_path, file_name)
`.trim();

export class NoteRepository extends SupabaseRepository<NoteResponseDTO> {
  constructor(supabase: SupabaseClient) {
    super(supabase, "agent_notes", NOTE_SELECT);
  }

  async getByContactId(contactId: string): Promise<NoteResponseDTO[]> {
    const { data, error } = await this.supabase
      .from("agent_notes")
      .select(NOTE_SELECT)
      .eq("contact_id", contactId)
      .eq("is_active", true)
      .eq("note_origin", "knowledge")
      .order("created_at", { ascending: false });

    if (error) handleSupabaseError(error, "Error al obtener notas del contacto");
    return (data ?? []) as unknown as NoteResponseDTO[];
  }

  async getByPolicyId(policyId: string): Promise<PolicyNoteRow[]> {
    const select = "id, source_type, created_at, document_metadata(storage_path, file_name)";

    const [{ data: active }, { data: obsolete }] = await Promise.all([
      this.supabase.from("agent_notes").select(select)
        .eq("policy_id", policyId).eq("note_origin", "policy").eq("is_active", true)
        .order("created_at", { ascending: false }),
      this.supabase.from("agent_notes").select(select)
        .eq("policy_id", policyId).eq("note_origin", "policy").eq("is_active", false)
        .eq("discard_reason", "policy_updated")
        .order("created_at", { ascending: false }),
    ]);

    const toRow = (r: Record<string, unknown>, isObsolete: boolean): PolicyNoteRow => ({
      id: r.id as string,
      source_type: r.source_type as string,
      created_at: r.created_at as string,
      isObsolete,
      document_metadata: r.document_metadata as PolicyNoteRow["document_metadata"],
    });

    return [
      ...(active ?? []).map((r) => toRow(r as Record<string, unknown>, false)),
      ...(obsolete ?? []).map((r) => toRow(r as Record<string, unknown>, true)),
    ];
  }

  async getRecent(limit = 20): Promise<RecentNoteRow[]> {
    const { data, error } = await this.supabase
      .from("agent_notes")
      .select(
        "id, contact_id, policy_id, source_type, created_at, document_metadata(file_name, storage_path), contacts(full_name)"
      )
      .eq("is_active", true)
      .not("document_metadata", "is", null)
      .order("created_at", { ascending: false })
      .limit(limit);

    if (error) handleSupabaseError(error, "Error al obtener documentos recientes");
    return (data ?? []) as unknown as RecentNoteRow[];
  }

  async deleteNote(agentId: string, noteId: string): Promise<void> {
    await this.supabase
      .from("agent_notes")
      .update({ discard_reason: "user_deleted" })
      .eq("id", noteId)
      .eq("agent_id", agentId)
      .eq("is_active", false)
      .eq("note_origin", "policy")
      .eq("discard_reason", "policy_updated");
  }
}
