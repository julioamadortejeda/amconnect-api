import { SupabaseClient } from "@supabase/supabase-js";
import { handleSupabaseError } from "../../shared/errors.ts";

export interface AgentUpdateData {
  fullName?: string;
  phone?: string;
}

export interface IAgentRepository {
  findById(agentId: string): Promise<Record<string, unknown> | null>;
  update(agentId: string, data: AgentUpdateData): Promise<Record<string, unknown> | null>;
}

export class AgentRepository implements IAgentRepository {
  constructor(private supabase: SupabaseClient) {}

  async findById(agentId: string): Promise<Record<string, unknown> | null> {
    const { data, error } = await this.supabase
      .from("agents")
      .select("*")
      .eq("id", agentId)
      .single();

    if (error) handleSupabaseError(error, "Perfil de asesor no encontrado.");
    return data as Record<string, unknown> | null;
  }

  async update(agentId: string, data: AgentUpdateData): Promise<Record<string, unknown> | null> {
    const payload: Record<string, unknown> = {};
    if (data.fullName !== undefined) payload.full_name = data.fullName;
    if (data.phone !== undefined) payload.phone = data.phone;

    const { data: result, error } = await this.supabase
      .from("agents")
      .update(payload)
      .eq("id", agentId)
      .select()
      .single();

    if (error) handleSupabaseError(error, "Error al actualizar el perfil.");
    return result as Record<string, unknown> | null;
  }
}
