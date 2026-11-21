import { SupabaseClient } from "@supabase/supabase-js";
import { handleSupabaseError } from "../../shared/errors.ts";

/** Lo que el job necesita del asesor dueño de cada fila. */
export interface JobAgentInfo {
  timezone: string | null;
  locale: string | null;
}

/** A policy as the daily job needs it: dates plus what drives its cadence. */
export interface JobPolicyRow extends JobAgentInfo {
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
  /** Holder: stored on the reminder and named in its title (D-023). */
  contactId: string | null;
  clientName: string | null;
  productName: string | null;
  branchName: string | null;
  branchCode: string | null;
  premium: number | null;
  currencyCode: string | null;
}

export interface JobContactRow extends JobAgentInfo {
  id: string;
  agentId: string;
  fullName: string | null;
  birthdate: string | null;
}

export interface IReminderGenerationJobRepository {
  findActivePolicies(offset: number, limit: number): Promise<JobPolicyRow[]>;
  findContactsWithBirthdate(offset: number, limit: number): Promise<JobContactRow[]>;
}

function agentInfo(raw: unknown): JobAgentInfo {
  const agent = raw as { timezone?: string | null; locale?: string | null } | null;
  return { timezone: agent?.timezone ?? null, locale: agent?.locale ?? null };
}

/**
 * Las dos lecturas del job. El asesor viene embebido (`!inner`) en vez de leer
 * `agents` aparte: así se filtran en la misma consulta los asesores inactivos,
 * y desaparecen las dos lecturas completas de `agents` que topaba `max_rows`.
 */
export class ReminderGenerationJobRepository implements IReminderGenerationJobRepository {
  constructor(private supabase: SupabaseClient) {}

  async findActivePolicies(offset: number, limit: number): Promise<JobPolicyRow[]> {
    const { data, error } = await this.supabase
      .from("policies")
      .select(
        "id, agent_id, policy_number, start_date, end_date, renewal_date, next_payment_date, premium, " +
          "product:products(name, branch_id, branch:branches(name, code)), " +
          "frequency:payment_frequencies!payment_frequency_id(months), " +
          "status:policy_statuses!status_id(code), currency:currencies(code), " +
          "agent:agents!agent_id!inner(timezone, locale), contact:contacts!inner(id, full_name)",
      )
      .eq("is_active", true)
      .eq("agent.is_active", true)
      // Borrar un contacto no propaga a sus pólizas: sin esto el job seguía
      // avisando de cobros de un cliente que el asesor ya dio de baja.
      .eq("contact.is_active", true)
      .order("id")
      .range(offset, offset + limit - 1);

    if (error) handleSupabaseError(error, "reminder_generation_job.findActivePolicies");

    return ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => {
      const product = r.product as {
        name?: string | null;
        branch_id?: string | null;
        branch?: { name?: string | null; code?: string | null } | null;
      } | null;
      const contact = r.contact as { id?: string | null; full_name?: string | null } | null;
      const currency = r.currency as { code?: string | null } | null;
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
        contactId: contact?.id ?? null,
        clientName: contact?.full_name ?? null,
        productName: product?.name ?? null,
        branchName: product?.branch?.name ?? null,
        branchCode: product?.branch?.code ?? null,
        premium: r.premium === null || r.premium === undefined ? null : Number(r.premium),
        currencyCode: currency?.code ?? null,
        ...agentInfo(r.agent),
      };
    });
  }

  async findContactsWithBirthdate(offset: number, limit: number): Promise<JobContactRow[]> {
    const { data, error } = await this.supabase
      .from("contacts")
      .select("id, agent_id, full_name, birthdate, agent:agents!agent_id!inner(timezone, locale)")
      .eq("is_active", true)
      .eq("agent.is_active", true)
      .not("birthdate", "is", null)
      .order("id")
      .range(offset, offset + limit - 1);

    if (error) handleSupabaseError(error, "reminder_generation_job.findContactsWithBirthdate");

    return ((data ?? []) as unknown as Record<string, unknown>[]).map((r) => ({
      id: r.id as string,
      agentId: r.agent_id as string,
      fullName: (r.full_name as string | null) ?? null,
      birthdate: (r.birthdate as string | null) ?? null,
      ...agentInfo(r.agent),
    }));
  }
}
