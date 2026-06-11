import { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseRepository } from "../../core/base_repository.ts";
import { PaginatedResult } from "../../core/repository.interface.ts";
import { ReminderResponseDTO } from "./reminder.dto.ts";

const REMINDER_SELECT = `
  *,
  type:reminder_types(id, name, code),
  contact:contacts(id, full_name),
  policy:policies(id, policy_number)
`.trim();

export class ReminderRepository extends SupabaseRepository<ReminderResponseDTO> {
  constructor(supabase: SupabaseClient) {
    super(supabase, "reminders", REMINDER_SELECT);
  }

  override paginate(
    filters: Partial<Record<string, unknown>> = {},
    page = 1,
    pageSize = 20,
  ): Promise<PaginatedResult<ReminderResponseDTO>> {
    return super.paginate(filters, page, pageSize, { column: "due_date", ascending: true, nullsFirst: false });
  }

  async searchReminders(agentId: string, queryText: string, isDone?: boolean): Promise<ReminderResponseDTO[] | null> {
    let q = this.supabase
      .from("reminders")
      .select(REMINDER_SELECT)
      .eq("agent_id", agentId)
      .eq("is_active", true);

    if (isDone !== undefined) {
      q = q.eq("is_done", isDone);
    }

    if (queryText) {
      q = q.or(`title.ilike.%${queryText}%,description.ilike.%${queryText}%`);
    }

    const { data, error } = await q.order("due_date", { ascending: true });
    if (error) {
      console.error("[ReminderRepository.searchReminders]:", error);
      return null;
    }
    return data as unknown as ReminderResponseDTO[];
  }
}
