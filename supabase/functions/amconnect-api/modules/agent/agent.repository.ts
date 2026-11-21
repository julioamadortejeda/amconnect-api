import { SupabaseClient } from "@supabase/supabase-js";
import { handleSupabaseError } from "../../shared/errors.ts";

export interface AgentUpdateData {
  fullName?: string;
  phone?: string;
  locale?: string;
}

export interface IAgentRepository {
  findById(agentId: string): Promise<Record<string, unknown> | null>;
  update(agentId: string, data: AgentUpdateData): Promise<Record<string, unknown> | null>;
  updateTimezone(agentId: string, timezone: string): Promise<void>;
  updateLocale(agentId: string, locale: string): Promise<void>;
  acceptPrivacyPolicy(version: string): Promise<void>;
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
    if (data.locale !== undefined) payload.locale = data.locale;

    const { data: result, error } = await this.supabase
      .from("agents")
      .update(payload)
      .eq("id", agentId)
      .select()
      .single();

    if (error) handleSupabaseError(error, "Error al actualizar el perfil.");
    return result as Record<string, unknown> | null;
  }

  async updateTimezone(agentId: string, timezone: string): Promise<void> {
    const { error } = await this.supabase
      .from("agents")
      .update({ timezone })
      .eq("id", agentId);

    if (error) handleSupabaseError(error, "agents.updateTimezone");
  }

  async updateLocale(agentId: string, locale: string): Promise<void> {
    const { error } = await this.supabase
      .from("agents")
      .update({ locale })
      .eq("id", agentId);

    if (error) handleSupabaseError(error, "agents.updateLocale");
  }

  /** Escribe el consentimiento vía `accept_privacy_policy` (security definer, fila del JWT). */
  async acceptPrivacyPolicy(version: string): Promise<void> {
    const { error } = await this.supabase.rpc("accept_privacy_policy", { p_version: version });
    if (error) handleSupabaseError(error, "agents.acceptPrivacyPolicy");
  }
}
