import { SupabaseClient } from "@supabase/supabase-js";
import { handleSupabaseError } from "../../shared/errors.ts";

export interface DocumentMetadataInsert {
  agent_id: string;
  file_name: string;
  storage_path: string;
  mime_type: string;
  ingestion_type?: string;
  raw_extraction?: Record<string, unknown>;
  extracted_at?: string;
  contact_id?: string | null;
  policy_id?: string | null;
}

export interface DocumentMetadata extends DocumentMetadataInsert {
  id: string;
  created_at: string;
}

export class DocumentMetadataRepository {
  constructor(private supabase: SupabaseClient) {}

  async create(data: DocumentMetadataInsert): Promise<DocumentMetadata | null> {
    const { data: result, error } = await this.supabase
      .from("document_metadata")
      .insert(data)
      .select()
      .single();
    if (error) handleSupabaseError(error, "Error al guardar los metadatos del documento.");
    return result;
  }
}
