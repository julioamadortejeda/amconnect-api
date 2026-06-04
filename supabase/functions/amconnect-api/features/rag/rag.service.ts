import { SupabaseClient } from "@supabase/supabase-js";
import { IAiProvider } from "../../core/ai_provider.interface.ts";

export interface NoteMatch {
  id: string;
  content: string;
  contactId: string | null;
  policyId: string | null;
  metadata: Record<string, unknown> | null;
  similarity: number;
}

export class RagService {
  constructor(
    private supabase: SupabaseClient,
    private aiProvider: IAiProvider,
  ) {}

  async searchNotes(
    agentId: string,
    query: string,
    options?: { contactId?: string; policyId?: string; threshold?: number; limit?: number },
  ): Promise<NoteMatch[]> {
    const embedding = await this.aiProvider.generateEmbedding(query);

    // deno-lint-ignore no-explicit-any
    const { data, error } = await (this.supabase.rpc as any)("search_agent_notes", {
      p_agent_id: agentId,
      p_query_embedding: JSON.stringify(embedding),
      p_match_threshold: options?.threshold ?? 0.7,
      p_match_count: options?.limit ?? 5,
    });

    if (error) {
      console.error("[RagService.searchNotes]:", error);
      return [];
    }

    let results = (data as NoteMatch[]) ?? [];

    if (options?.contactId) {
      results = results.filter((r) => r.contactId === options.contactId);
    }
    if (options?.policyId) {
      results = results.filter((r) => r.policyId === options.policyId);
    }

    return results;
  }

  formatContextForPrompt(notes: NoteMatch[]): string {
    if (notes.length === 0) return "";
    return notes
      .map((n, i) => `[Nota ${i + 1}]: ${n.content}`)
      .join("\n");
  }
}
