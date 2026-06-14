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

export interface CreateReminderData {
  agentId: string;
  policyId: string;
  typeId: string;
  title: string;
  dueDate: string;
}

export interface IReminderGenerationRepository {
  findStatusIdsByCodes(codes: string[]): Promise<Record<string, string>>;
  findReminderTypesByCodes(codes: string[]): Promise<ReminderTypeRow[]>;
  findExistingReminder(agentId: string, policyId: string, typeId: string, closedStatusIds: string[]): Promise<ExistingReminderRow | null>;
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

  async findReminderTypesByCodes(codes: string[]): Promise<ReminderTypeRow[]> {
    const { data } = await this.supabase
      .from("reminder_types")
      .select("id, code, name")
      .in("code", codes)
      .eq("is_active", true);

    return (data ?? []).map((t: { id: string; code: string; name: string }) => ({
      id: t.id,
      code: t.code,
      name: t.name,
    }));
  }

  async findExistingReminder(
    agentId: string,
    policyId: string,
    typeId: string,
    closedStatusIds: string[],
  ): Promise<ExistingReminderRow | null> {
    let query = this.supabase
      .from("reminders")
      .select("id, title, due_date")
      .eq("agent_id", agentId)
      .eq("policy_id", policyId)
      .eq("type_id", typeId);

    if (closedStatusIds.length > 0) {
      query = query.not("status_id", "in", `(${closedStatusIds.join(",")})`);
    }

    const { data } = await query.limit(1).maybeSingle();
    if (!data) return null;
    return { id: data.id, title: data.title, dueDate: data.due_date };
  }

  async createReminder(data: CreateReminderData, createdStatusId: string): Promise<string | null> {
    const { data: newRow, error } = await this.supabase
      .from("reminders")
      .insert({
        agent_id: data.agentId,
        policy_id: data.policyId,
        type_id: data.typeId,
        title: data.title,
        due_date: data.dueDate,
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
