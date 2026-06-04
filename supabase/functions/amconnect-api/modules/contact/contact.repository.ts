import { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseRepository } from "../../core/base_repository.ts";
import { ContactResponseDTO } from "./contact.dto.ts";

export class ContactRepository extends SupabaseRepository<ContactResponseDTO> {
  constructor(supabase: SupabaseClient) {
    super(supabase, "contacts");
  }

  async findSimilar(agentId: string, query: string): Promise<ContactResponseDTO[] | null> {
    // deno-lint-ignore no-explicit-any
    const { data, error } = await (this.supabase.rpc as any)("search_contacts", {
      p_agent_id: agentId,
      p_query: query,
      p_threshold: 0.2,
    });

    if (error) {
      console.error("[ContactRepository.findSimilar]:", error);
      return null;
    }
    return data as ContactResponseDTO[];
  }
}
