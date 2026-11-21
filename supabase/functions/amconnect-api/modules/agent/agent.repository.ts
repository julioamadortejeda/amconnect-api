import { SupabaseClient } from "@supabase/supabase-js";
import { handleSupabaseError } from "../../shared/errors.ts";
import type { RequestEvidence } from "../../shared/request_evidence.ts";

export interface AgentUpdateData {
  fullName?: string;
  phone?: string;
  locale?: string;
}

export interface PrivacyConsentRecord {
  version: string;
  acceptedNotice: boolean;
  acceptedSensitive: boolean;
  evidence: RequestEvidence;
}

export interface IAgentRepository {
  findById(agentId: string): Promise<Record<string, unknown> | null>;
  update(agentId: string, data: AgentUpdateData): Promise<Record<string, unknown> | null>;
  updateTimezone(agentId: string, timezone: string): Promise<void>;
  updateLocale(agentId: string, locale: string): Promise<void>;
  recordPrivacyConsent(input: PrivacyConsentRecord): Promise<void>;
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

  /** Escribe el consentimiento y su evidencia vía `record_privacy_consent` (security definer, fila del JWT). */
  async recordPrivacyConsent(input: PrivacyConsentRecord): Promise<void> {
    const { error } = await this.supabase.rpc("record_privacy_consent", {
      p_version: input.version,
      p_accepted_notice: input.acceptedNotice,
      p_accepted_sensitive: input.acceptedSensitive,
      p_ip: input.evidence.ip,
      p_user_agent: input.evidence.userAgent,
      p_app_version: input.evidence.appVersion,
      p_platform: input.evidence.platform,
      p_locale: input.evidence.locale,
    });
    if (error) handleSupabaseError(error, "agents.recordPrivacyConsent");
  }
}
