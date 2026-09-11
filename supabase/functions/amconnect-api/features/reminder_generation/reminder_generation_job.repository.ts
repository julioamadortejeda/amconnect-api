import { SupabaseClient } from "@supabase/supabase-js";
import { handleSupabaseError } from "../../shared/errors.ts";

/** A policy as the daily job needs it: dates plus what drives its cadence. */
export interface JobPolicyRow {
  id: string;
  agentId: string;
  policyNumber: string | null;
  startDate: string | null;
  endDate: string | null;
  renewalDate: string | null;
  nextPaymentDate: string | null;
  branchId: string | null;
  paymentFrequencyMonths: number | null;
  /** Catalog code of the policy status, when the advisor set one. */
  statusCode: string | null;
}

export interface JobContactRow {
  id: string;
  agentId: string;
  fullName: string | null;
  birthdate: string | null;
}

export interface IReminderGenerationJobRepository {
  findActivePolicies(offset: number, limit: number): Promise<JobPolicyRow[]>;
  findContactsWithBirthdate(offset: number, limit: number): Promise<JobContactRow[]>;
  findAgentTimezones(): Promise<Map<string, string | null>>;
  findAgentLocales(): Promise<Map<string, string | null>>;
}

export class ReminderGenerationJobRepository implements IReminderGenerationJobRepository {
  constructor(private supabase: SupabaseClient) {}

  async findActivePolicies(offset: number, limit: number): Promise<JobPolicyRow[]> {
    const { data, error } = await this.supabase
      .from("policies")
      .select(
        "id, agent_id, policy_number, start_date, end_date, renewal_date, next_payment_date, " +
          "product:products!product_id(branch_id), frequency:payment_frequencies!payment_frequency_id(months), " +
          "status:policy_statuses!status_id(code)",
      )
      .eq("is_active", true)
      .order("id")
      .range(offset, offset + limit - 1);

    if (error) handleSupabaseError(error, "reminder_generation_job.findActivePolicies");

    return ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => {
      const product = r.product as { branch_id?: string | null } | null;
      const frequency = r.frequency as { months?: number | null } | null;
      const status = r.status as { code?: string | null } | null;
      return {
        id: r.id as string,
        agentId: r.agent_id as string,
        policyNumber: (r.policy_number as string | null) ?? null,
        startDate: (r.start_date as string | null) ?? null,
        endDate: (r.end_date as string | null) ?? null,
        renewalDate: (r.renewal_date as string | null) ?? null,
        nextPaymentDate: (r.next_payment_date as string | null) ?? null,
        branchId: product?.branch_id ?? null,
        paymentFrequencyMonths: frequency?.months ?? null,
        statusCode: status?.code ?? null,
      };
    });
  }

  /** Zona horaria por asesor, para fechar cada recordatorio en su día local. */
  async findAgentTimezones(): Promise<Map<string, string | null>> {
    const { data, error } = await this.supabase
      .from("agents")
      .select("id, timezone")
      .eq("is_active", true);

    if (error) handleSupabaseError(error, "reminder_generation_job.findAgentTimezones");

    return new Map(
      (data ?? []).map((row) => {
        const r = row as { id: string; timezone: string | null };
        return [r.id, r.timezone ?? null];
      }),
    );
  }

  /** El idioma en que se escriben los títulos. Ver agents.locale. */
  async findAgentLocales(): Promise<Map<string, string | null>> {
    const { data, error } = await this.supabase
      .from("agents")
      .select("id, locale")
      .eq("is_active", true);

    if (error) handleSupabaseError(error, "reminder_generation_job.findAgentLocales");

    return new Map(
      (data ?? []).map((row) => {
        const r = row as { id: string; locale: string | null };
        return [r.id, r.locale ?? null];
      }),
    );
  }

  async findContactsWithBirthdate(offset: number, limit: number): Promise<JobContactRow[]> {
    const { data, error } = await this.supabase
      .from("contacts")
      .select("id, agent_id, full_name, birthdate")
      .eq("is_active", true)
      .not("birthdate", "is", null)
      .order("id")
      .range(offset, offset + limit - 1);

    if (error) handleSupabaseError(error, "reminder_generation_job.findContactsWithBirthdate");

    return (data ?? []).map((row) => {
      const r = row as Record<string, unknown>;
      return {
        id: r.id as string,
        agentId: r.agent_id as string,
        fullName: (r.full_name as string | null) ?? null,
        birthdate: (r.birthdate as string | null) ?? null,
      };
    });
  }
}
