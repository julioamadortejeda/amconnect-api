import { SupabaseClient } from "@supabase/supabase-js";
import { handleSupabaseError } from "../../shared/errors.ts";

interface DocumentMetadataRow {
  storage_path: string;
  file_name: string;
}

export interface NoteRow {
  id: string;
  contact_id: string | null;
  policy_id: string | null;
  source_type: string;
  content: string;
  summary: string | null;
  note_origin: string;
  created_at: string;
  document_metadata: DocumentMetadataRow | null;
}

export interface PolicyNoteRow {
  id: string;
  source_type: string;
  created_at: string;
  isObsolete: boolean;
  document_metadata: DocumentMetadataRow | null;
}

export class NoteRepository {
  constructor(private supabase: SupabaseClient) {}

  async getByContactId(contactId: string): Promise<NoteRow[]> {
    const { data, error } = await this.supabase
      .from("agent_notes")
      .select(
        "id, contact_id, policy_id, source_type, content, summary, note_origin, created_at, document_metadata(storage_path, file_name)"
      )
      .eq("contact_id", contactId)
      .eq("is_active", true)
      .eq("note_origin", "knowledge")
      .order("created_at", { ascending: false });

    if (error) handleSupabaseError(error, "Error al obtener notas del contacto");
    return (data ?? []) as unknown as NoteRow[];
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

    // deno-lint-ignore no-explicit-any
    const toRow = (r: any, isObsolete: boolean): PolicyNoteRow => ({
      id: r.id as string,
      source_type: r.source_type as string,
      created_at: r.created_at as string,
      isObsolete,
      document_metadata: r.document_metadata as DocumentMetadataRow | null,
    });

    return [
      ...(active ?? []).map((r) => toRow(r, false)),
      ...(obsolete ?? []).map((r) => toRow(r, true)),
    ];
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
