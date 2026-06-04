import { SupabaseClient } from "@supabase/supabase-js";
import { IAiProvider } from "../../core/ai_provider.interface.ts";

export interface NoteInput {
  content: string;
  contactId?: string | null;
  policyId?: string | null;
  metadata?: Record<string, unknown>;
}

export class EmbeddingsService {
  constructor(
    private supabase: SupabaseClient,
    private aiProvider: IAiProvider,
  ) {}

  async saveNote(agentId: string, note: NoteInput): Promise<void> {
    const embedding = await this.aiProvider.generateEmbedding(note.content);

    await this.supabase.from("agent_notes_vectors").insert({
      agent_id: agentId,
      contact_id: note.contactId ?? null,
      policy_id: note.policyId ?? null,
      content: note.content,
      embedding: JSON.stringify(embedding),
      metadata: note.metadata ?? null,
    });
  }

  async saveBatch(agentId: string, notes: NoteInput[]): Promise<void> {
    const rows = await Promise.all(
      notes.map(async (note) => ({
        agent_id: agentId,
        contact_id: note.contactId ?? null,
        policy_id: note.policyId ?? null,
        content: note.content,
        embedding: JSON.stringify(await this.aiProvider.generateEmbedding(note.content)),
        metadata: note.metadata ?? null,
      })),
    );

    await this.supabase.from("agent_notes_vectors").insert(rows);
  }
}
