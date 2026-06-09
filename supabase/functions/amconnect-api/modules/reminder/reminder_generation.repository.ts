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
  findReminderTypesByCodes(codes: string[]): Promise<ReminderTypeRow[]>;
  findExistingReminder(agentId: string, policyId: string, typeId: string): Promise<ExistingReminderRow | null>;
  createReminder(data: CreateReminderData): Promise<string | null>;
}

export class ReminderGenerationRepository implements IReminderGenerationRepository {
  constructor(private supabase: SupabaseClient) {}

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
  ): Promise<ExistingReminderRow | null> {
    const { data } = await this.supabase
      .from("reminders")
      .select("id, title, due_date")
      .eq("agent_id", agentId)
      .eq("policy_id", policyId)
      .eq("type_id", typeId)
      .eq("is_done", false)
      .limit(1)
      .maybeSingle();

    if (!data) return null;
    return { id: data.id, title: data.title, dueDate: data.due_date };
  }

  async createReminder(data: CreateReminderData): Promise<string | null> {
    const { data: newRow, error } = await this.supabase
      .from("reminders")
      .insert({
        agent_id: data.agentId,
        policy_id: data.policyId,
        type_id: data.typeId,
        title: data.title,
        due_date: data.dueDate,
        is_done: false,
      })
      .select("id")
      .single();

    if (error || !newRow) return null;
    return (newRow as { id: string }).id;
  }
}
