import { SupabaseClient } from "@supabase/supabase-js";

export interface ReminderTypeRow {
  id: string;
  code: string;
  name: string;
}

export interface ExistingReminderRow {
  id: string;
  title: string;
  dueDate: string;
}

/** What a generated reminder hangs from: a policy, or a contact for birthdays. */
export interface ReminderOwner {
  policyId?: string | null;
  contactId?: string | null;
}

export interface CreateReminderData {
  agentId: string;
  owner: ReminderOwner;
  typeId: string;
  title: string;
  dueDate: string;
  /** Ocurrencia del calendario que cubre; no cambia si se reagenda. */
  occurrenceDate: string;
  /** Solo cuando la fecha se dedujo en vez de leerse de la carátula. */
  description?: string;
}

/** The bits of a policy the schedule depends on, resolved from its product. */
export interface PolicyScheduleInfo {
  branchId: string | null;
  frequencyMonths: number | null;
}

export interface IReminderGenerationRepository {
  findStatusIdsByCodes(codes: string[]): Promise<Record<string, string>>;
  findReminderTypesByCodes(codes: readonly string[]): Promise<ReminderTypeRow[]>;
  findPolicyScheduleInfo(policyId: string): Promise<PolicyScheduleInfo | null>;
  findReminderForOccurrence(
    agentId: string,
    owner: ReminderOwner,
    typeId: string,
    occurrenceDate: string,
  ): Promise<ExistingReminderRow | null>;
  createReminder(data: CreateReminderData, createdStatusId: string): Promise<string | null>;
}

export class ReminderGenerationRepository implements IReminderGenerationRepository {
  constructor(private supabase: SupabaseClient) {}

  async findStatusIdsByCodes(codes: string[]): Promise<Record<string, string>> {
    const { data } = await this.supabase
      .from("reminder_statuses")
      .select("id, code")
      .in("code", codes);

    const result: Record<string, string> = {};
    for (const row of data ?? []) {
      result[(row as { id: string; code: string }).code] = (row as { id: string; code: string }).id;
    }
    return result;
  }

  async findReminderTypesByCodes(codes: readonly string[]): Promise<ReminderTypeRow[]> {
    const { data } = await this.supabase
      .from("reminder_types")
      .select("id, code, name")
      .in("code", codes as string[])
      .eq("is_active", true);

    return (data ?? []).map((t: { id: string; code: string; name: string }) => ({
      id: t.id,
      code: t.code,
      name: t.name,
    }));
  }

  async findPolicyScheduleInfo(policyId: string): Promise<PolicyScheduleInfo | null> {
    const { data } = await this.supabase
      .from("policies")
      .select("product:products!product_id(branch_id), frequency:payment_frequencies!payment_frequency_id(months)")
      .eq("id", policyId)
      .maybeSingle();

    if (!data) return null;
    const row = data as {
      product?: { branch_id?: string | null } | null;
      frequency?: { months?: number | null } | null;
    };
    return {
      branchId: row.product?.branch_id ?? null,
      frequencyMonths: row.frequency?.months ?? null,
    };
  }

  private applyOwner<T extends { eq: (c: string, v: string) => T; is: (c: string, v: null) => T }>(
    query: T,
    owner: ReminderOwner,
  ): T {
    return owner.policyId
      ? query.eq("policy_id", owner.policyId)
      : query.eq("contact_id", owner.contactId as string).is("policy_id", null);
  }

  /**
   * El recordatorio que cubre ESTA ocurrencia, si ya existe.
   *
   * Se busca por `occurrence_date` y no por `due_date` a propósito: reagendar
   * mueve la fecha del aviso, no el ciclo que cubre. Así, mover el pago de
   * agosto a diciembre no hace que agosto se vuelva a generar, y diciembre
   * (u octubre, o el ciclo que toque) sigue generando el suyo.
   *
   * Cuenta cualquier estado: abierto porque el asesor está en eso, HECHO porque
   * se pagó, CANCELADO porque no quiere ese aviso. En los tres insistir sería
   * pelearse con él.
   */
  async findReminderForOccurrence(
    agentId: string,
    owner: ReminderOwner,
    typeId: string,
    occurrenceDate: string,
  ): Promise<ExistingReminderRow | null> {
    let query = this.supabase
      .from("reminders")
      .select("id, title, due_date")
      .eq("agent_id", agentId)
      .eq("type_id", typeId)
      .eq("is_active", true)
      .eq("occurrence_date", occurrenceDate);

    query = this.applyOwner(query, owner);

    const { data } = await query.limit(1).maybeSingle();
    if (!data) return null;
    return { id: data.id, title: data.title, dueDate: data.due_date };
  }

  async createReminder(data: CreateReminderData, createdStatusId: string): Promise<string | null> {
    const { data: newRow, error } = await this.supabase
      .from("reminders")
      .insert({
        agent_id: data.agentId,
        policy_id: data.owner.policyId ?? null,
        contact_id: data.owner.contactId ?? null,
        type_id: data.typeId,
        title: data.title,
        description: data.description ?? null,
        due_date: data.dueDate,
        occurrence_date: data.occurrenceDate,
        status_id: createdStatusId,
      })
      .select("id")
      .single();

    if (error || !newRow) {
      console.error("[ReminderGenerationRepository.createReminder]:", error?.message ?? "no row returned");
      return null;
    }
    return (newRow as { id: string }).id;
  }
}
