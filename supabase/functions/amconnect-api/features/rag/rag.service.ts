import { SupabaseClient } from "@supabase/supabase-js";
import { IEmbeddingProvider } from "../../core/embedding_provider.interface.ts";

export interface NoteMatch {
  chunkId: string;
  noteId: string;
  content: string;
  contactId: string | null;
  policyId: string | null;
  similarity: number;
  sourceType: string;
  metadata: Record<string, unknown> | null;
}

export class RagService {
  constructor(
    private supabase: SupabaseClient,
    private embeddingProvider: IEmbeddingProvider,
  ) {}

  async searchNotes(
    agentId: string,
    query: string,
    options?: { contactId?: string; policyId?: string; threshold?: number; limit?: number },
  ): Promise<NoteMatch[]> {
    debugger;
    const { embedding } = await this.embeddingProvider.generateEmbedding(query);

    // deno-lint-ignore no-explicit-any
    const { data, error } = await (this.supabase.rpc as any)("search_agent_note_chunks", {
      p_agent_id: agentId,
      p_query_embedding: JSON.stringify(embedding),
      p_match_threshold: options?.threshold ?? 0.7,
      p_match_count: options?.limit ?? 5,
    });

    if (error) {
      console.error("[RagService.searchNotes]:", error);
      return [];
    }

    let results: NoteMatch[] = (data ?? []).map((r: Record<string, unknown>) => ({
      chunkId: r.chunk_id as string,
      noteId: r.note_id as string,
      content: r.content as string,
      contactId: r.contact_id as string | null,
      policyId: r.policy_id as string | null,
      similarity: r.similarity as number,
      sourceType: r.source_type as string,
      metadata: r.metadata as Record<string, unknown> | null,
    }));

    if (options?.contactId) results = results.filter((r) => r.contactId === options.contactId);
    if (options?.policyId) results = results.filter((r) => r.policyId === options.policyId);

    return results;
  }

  formatContextForPrompt(notes: NoteMatch[]): string {
    if (notes.length === 0) return "";
    return notes.map((n, i) => `[Nota ${i + 1}]: ${n.content}`).join("\n");
  }
}
