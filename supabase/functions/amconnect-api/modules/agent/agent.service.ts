import { SupabaseClient } from "@supabase/supabase-js";
import { AgentUpdateDTO } from "./agent.dto.ts";
import { NotFoundError, handleSupabaseError } from "../../shared/errors.ts";
import { toCamelCase, objectToCamelCase } from "../../shared/case_converter.ts";

export class AgentService {
  constructor(private supabase: SupabaseClient) {}

  async getMe(agentId: string) {
    const { data, error } = await this.supabase
      .from("agents")
      .select("*")
      .eq("id", agentId)
      .single();

    if (error) handleSupabaseError(error, "Perfil de asesor no encontrado.");
    if (!data) throw new NotFoundError("Perfil de asesor no encontrado.");

    return objectToCamelCase(data as Record<string, unknown>);
  }

  async updateMe(agentId: string, dto: AgentUpdateDTO) {
    const payload: Record<string, unknown> = {};
    if (dto.fullName !== undefined) payload.full_name = dto.fullName;
    if (dto.phone !== undefined) payload.phone = dto.phone;

    const { data, error } = await this.supabase
      .from("agents")
      .update(payload)
      .eq("id", agentId)
      .select()
      .single();

    if (error) handleSupabaseError(error, "Error al actualizar el perfil.");
    return objectToCamelCase(data as Record<string, unknown>);
  }
}
