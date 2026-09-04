import { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseRepository } from "../../core/base_repository.ts";
import { ContactResponseDTO } from "./contact.dto.ts";

export class ContactRepository extends SupabaseRepository<ContactResponseDTO> {
  constructor(supabase: SupabaseClient) {
    super(supabase, "contacts");
  }

  async findSimilar(agentId: string, query: string): Promise<ContactResponseDTO[] | null> {
    // Sin `p_threshold`: el umbral vive en el default de la función SQL porque
    // es propiedad de la escala que usa (word_similarity, no similarity), no de
    // quien la llama. Mandarlo desde aquí ya costó caro una vez — el 0.2
    // hardcodeado sobrevivió a un cambio de escala y dejó de encontrar clientes
    // en silencio (ver 20260828130000_search_contacts_word_similarity.sql).
    // deno-lint-ignore no-explicit-any
    const { data, error } = await (this.supabase.rpc as any)("search_contacts", {
      p_agent_id: agentId,
      p_query: query,
    });

    if (error) {
      console.error("[ContactRepository.findSimilar]:", error);
      return null;
    }
    return data as ContactResponseDTO[];
  }
}
