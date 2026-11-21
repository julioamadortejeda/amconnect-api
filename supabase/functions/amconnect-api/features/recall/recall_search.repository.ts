import { SupabaseClient } from "@supabase/supabase-js";
import { handleSupabaseError } from "../../shared/errors.ts";

export interface StoredSearch {
  id: string;
  query: string;
  embedding: number[];
}

export interface IRecallSearchRepository {
  /** La búsqueda `id` del asesor creada después de `notBefore`; null si no existe o venció. */
  findValid(agentId: string, id: string, notBefore: Date): Promise<StoredSearch | null>;
  insert(agentId: string, query: string, embedding: number[]): Promise<string>;
  /** Borra las búsquedas vencidas del asesor. */
  deleteExpired(agentId: string, before: Date): Promise<void>;
}

/** Tabla `recall_searches` (RLS: agent_id = auth.uid()). */
export class RecallSearchRepository implements IRecallSearchRepository {
  constructor(private supabase: SupabaseClient) {}

  async findValid(agentId: string, id: string, notBefore: Date): Promise<StoredSearch | null> {
    const { data, error } = await this.supabase
      .from("recall_searches")
      .select("id, query, embedding")
      .eq("id", id)
      .eq("agent_id", agentId)
      .gte("created_at", notBefore.toISOString())
      .maybeSingle();
    if (error) handleSupabaseError(error, "Error al leer la búsqueda guardada");
    if (!data) return null;
    // pgvector llega por PostgREST como texto "[0.1,0.2,...]".
    const raw = data.embedding as string | number[];
    return { id: data.id as string, query: data.query as string, embedding: typeof raw === "string" ? JSON.parse(raw) : raw };
  }

  async insert(agentId: string, query: string, embedding: number[]): Promise<string> {
    const { data, error } = await this.supabase
      .from("recall_searches")
      .insert({ agent_id: agentId, query, embedding: JSON.stringify(embedding) })
      .select("id")
      .single();
    if (error) handleSupabaseError(error, "Error al guardar la búsqueda");
    return data.id as string;
  }

  async deleteExpired(agentId: string, before: Date): Promise<void> {
    const { error } = await this.supabase
      .from("recall_searches")
      .delete()
      .eq("agent_id", agentId)
      .lt("created_at", before.toISOString());
    if (error) handleSupabaseError(error, "Error al limpiar búsquedas vencidas");
  }
}
