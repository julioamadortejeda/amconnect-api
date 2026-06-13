import { SupabaseClient } from "@supabase/supabase-js";

export interface NoteMatch {
  chunkId: string;
  noteId: string;
  content: string;
  contactId: string | null;
  policyId: string | null;
  similarity: number;
  sourceType: string;
}

export interface SearchNoteChunksOptions {
  contactId?: string;
  policyId?: string;
}

export interface IRagRepository {
  searchNoteChunks(
    agentId: string,
    queryEmbedding: string,
    threshold: number,
    limit: number,
    options?: SearchNoteChunksOptions,
  ): Promise<NoteMatch[]>;
}

export class RagRepository implements IRagRepository {
  constructor(private supabase: SupabaseClient) {}

  async searchNoteChunks(
    agentId: string,
    queryEmbedding: string,
    threshold: number,
    limit: number,
    options?: SearchNoteChunksOptions,
  ): Promise<NoteMatch[]> {
    // deno-lint-ignore no-explicit-any
    let query = (this.supabase.rpc as any)("search_agent_note_chunks", {
      p_agent_id: agentId,
      p_query_embedding: queryEmbedding,
      p_match_threshold: threshold,
      p_match_count: limit,
    });

    if (options?.contactId) query = query.eq("contact_id", options.contactId);
    if (options?.policyId) query = query.eq("policy_id", options.policyId);

    // deno-lint-ignore no-explicit-any
    const { data, error } = await (query as any);

    if (error) {
      console.error("[RagRepository.searchNoteChunks]:", error.message);
      return [];
    }

    return (data ?? []).map((r: Record<string, unknown>) => ({
      chunkId: r.chunk_id as string,
      noteId: r.note_id as string,
      content: r.content as string,
      contactId: r.contact_id as string | null,
      policyId: r.policy_id as string | null,
      similarity: r.similarity as number,
      sourceType: r.source_type as string,
    }));
  }
}
