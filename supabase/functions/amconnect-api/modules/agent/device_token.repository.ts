import { SupabaseClient } from "@supabase/supabase-js";
import { handleSupabaseError } from "../../shared/errors.ts";

export interface IDeviceTokenRepository {
  upsert(agentId: string, token: string, platform: string): Promise<Record<string, unknown> | null>;
  findByAgentId(agentId: string): Promise<Record<string, unknown>[] | null>;
  deleteOldestTokens(agentId: string, keepCount: number): Promise<void>;
  deleteByToken(token: string): Promise<void>;
}

export class DeviceTokenRepository implements IDeviceTokenRepository {
  constructor(private supabase: SupabaseClient) {}

  async upsert(agentId: string, token: string, platform: string): Promise<Record<string, unknown> | null> {
    // 1. Limpiar cualquier registro previo de este token para evitar duplicados en cambios de cuenta
    const { error: deleteError } = await this.supabase
      .from("agent_device_tokens")
      .delete()
      .eq("token", token);

    if (deleteError) {
      console.warn("[DeviceTokenRepository.upsert] Warning cleaning up previous token owners:", deleteError.message);
    }

    // 2. Insertar o actualizar el token para el agente actual
    const { data, error } = await this.supabase
      .from("agent_device_tokens")
      .upsert(
        {
          agent_id: agentId,
          token,
          platform,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "agent_id,token" }
      )
      .select()
      .single();

    if (error) handleSupabaseError(error, "Error al registrar el token del dispositivo.");
    return data;
  }

  async findByAgentId(agentId: string): Promise<Record<string, unknown>[] | null> {
    const { data, error } = await this.supabase
      .from("agent_device_tokens")
      .select("*")
      .eq("agent_id", agentId)
      .order("created_at", { ascending: false });

    if (error) handleSupabaseError(error, "Error al buscar tokens de dispositivo.");
    return data;
  }

  async deleteOldestTokens(agentId: string, keepCount: number): Promise<void> {
    // 1. Obtener todos los tokens del agente ordenados por updated_at descendiente (más reciente primero)
    const { data: tokens, error } = await this.supabase
      .from("agent_device_tokens")
      .select("id")
      .eq("agent_id", agentId)
      .order("updated_at", { ascending: false });

    if (error) {
      console.error("[DeviceTokenRepository.deleteOldestTokens] Error fetching tokens:", error.message);
      return;
    }

    if (!tokens || tokens.length <= keepCount) {
      return; // No necesitamos borrar nada
    }

    // 2. Extraer los IDs de los tokens sobrantes que exceden el keepCount (los más viejos)
    const idsToDelete = tokens.slice(keepCount).map((t) => t.id);

    // 3. Eliminarlos de la base de datos
    const { error: deleteError } = await this.supabase
      .from("agent_device_tokens")
      .delete()
      .in("id", idsToDelete);

    if (deleteError) {
      console.error("[DeviceTokenRepository.deleteOldestTokens] Error deleting excess tokens:", deleteError.message);
    }
  }

  async deleteByToken(token: string): Promise<void> {
    const { error } = await this.supabase
      .from("agent_device_tokens")
      .delete()
      .eq("token", token);

    if (error) {
      console.error(`[DeviceTokenRepository.deleteByToken] Error deleting token ${token}:`, error.message);
    }
  }
}
