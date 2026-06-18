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

type RawNoteRow = Omit<NoteRow, "document_metadata"> & {
  document_metadata: DocumentMetadataRow[];
};

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
    return ((data ?? []) as RawNoteRow[]).map((row) => ({
      ...row,
      document_metadata: row.document_metadata?.[0] ?? null,
    }));
  }
}
