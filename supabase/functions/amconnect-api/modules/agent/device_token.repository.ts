import { SupabaseClient } from "@supabase/supabase-js";
import { handleSupabaseError } from "../../shared/errors.ts";

export interface IDeviceTokenRepository {
  claim(token: string, platform: string): Promise<Record<string, unknown> | null>;
  findByAgentId(agentId: string): Promise<Record<string, unknown>[] | null>;
  deleteOldestTokens(agentId: string, keepCount: number): Promise<void>;
  deleteByToken(token: string): Promise<void>;
}

export class DeviceTokenRepository implements IDeviceTokenRepository {
  constructor(private supabase: SupabaseClient) {}

  /**
   * Registra el token para el asesor del JWT y se lo quita a cualquier otro
   * dueño (`claim_device_token`, migración 20261121002508). Antes se intentaba
   * un delete previo, pero la RLS solo deja borrar filas propias: no fallaba,
   * no borraba nada, y el mismo teléfono quedaba registrado para dos asesores.
   */
  async claim(token: string, platform: string): Promise<Record<string, unknown> | null> {
    const { data, error } = await this.supabase
      .rpc("claim_device_token", { p_token: token, p_platform: platform })
      .single();

    if (error) handleSupabaseError(error, "Error al registrar el token del dispositivo.");
    return data as Record<string, unknown> | null;
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
      console.error(`[DeviceTokenRepository.deleteByToken] Error deleting token ${token.substring(0, 10)}...:`, error.message);
    }
  }
}
