export interface NoteResponseDTO {
  id: string;
  contact_id: string | null;
  policy_id: string | null;
  source_type: string;
  content: string;
  summary: string | null;
  note_origin: string;
  created_at: string;
  document_metadata: { storage_path: string; file_name: string } | null;
}

export interface PolicyNoteRow {
  id: string;
  source_type: string;
  created_at: string;
  isObsolete: boolean;
  document_metadata: { storage_path: string; file_name: string } | null;
}

export interface RecentNoteRow {
  id: string;
  contact_id: string | null;
  policy_id: string | null;
  source_type: string;
  created_at: string;
  document_metadata: { file_name: string; storage_path: string } | null;
  contacts: { full_name: string } | null;
  content?: string;
  summary?: string | null;
}
