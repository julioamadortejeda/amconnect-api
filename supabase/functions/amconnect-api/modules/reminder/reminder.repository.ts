import { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseRepository } from "../../core/base_repository.ts";
import { PaginatedResult } from "../../core/repository.interface.ts";
import { ReminderResponseDTO } from "./reminder.dto.ts";
import { AppError } from "../../shared/errors.ts";

const REMINDER_SELECT = `
  *,
  type:reminder_types(id, name, code),
  status:reminder_statuses(id, name, code),
  comments:reminder_comments(id, reminder_id, agent_id, content, created_at),
  contact:contacts(id, full_name),
  policy:policies(id, policy_number)
`.trim();

export class ReminderRepository extends SupabaseRepository<ReminderResponseDTO> {
  constructor(supabase: SupabaseClient) {
    super(supabase, "reminders", REMINDER_SELECT);
  }

  get client(): SupabaseClient {
    return this.supabase;
  }

  override paginate(
    filters: Partial<Record<string, unknown>> = {},
    page = 1,
    pageSize = 20,
  ): Promise<PaginatedResult<ReminderResponseDTO>> {
    return super.paginate(filters, page, pageSize, { column: "due_date", ascending: true, nullsFirst: false });
  }

  async searchReminders(agentId: string, queryText: string, statusCode?: string): Promise<ReminderResponseDTO[] | null> {
    let q = this.supabase
      .from("reminders")
      .select(REMINDER_SELECT)
      .eq("agent_id", agentId)
      .eq("is_active", true);

    if (statusCode) {
      const { data: statusData } = await this.supabase
        .from("reminder_statuses")
        .select("id")
        .eq("code", statusCode.toUpperCase())
        .single();
      if (statusData) {
        q = q.eq("status_id", statusData.id);
      } else {
        throw new AppError(`Status code '${statusCode}' not found in reminder_statuses catalog`, 400);
      }
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
