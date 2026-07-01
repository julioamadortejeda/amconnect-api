import { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseRepository } from "../../core/base_repository.ts";
import { PaginatedResult } from "../../core/repository.interface.ts";
import { ReminderResponseDTO } from "./reminder.dto.ts";
import { AppError } from "../../shared/errors.ts";

export interface DueReminderRow {
  id: string;
  title: string;
  description: string | null;
  agent_id: string;
  due_date: string;
}

export interface INotificationReminderRepository {
  findDueUnnotified(): Promise<DueReminderRow[]>;
  markNotified(id: string): Promise<void>;
}

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

  async findDueUnnotified(): Promise<DueReminderRow[]> {
    const nowStr = new Date().toISOString();

    const { data: statuses, error: statusErr } = await this.supabase
      .from("reminder_statuses")
      .select("id")
      .in("code", ["CREATED", "IN_PROGRESS"]);

    if (statusErr || !statuses) {
      throw new AppError(`Failed to load reminder statuses: ${statusErr?.message}`, 500);
    }

    const { data, error } = await this.supabase
      .from("reminders")
      .select("id, title, description, agent_id, due_date")
      .eq("is_active", true)
      .in("status_id", statuses.map((s) => s.id))
      .lte("due_date", nowStr)
      .is("notified_at", null);

    if (error) throw new AppError(`Failed to load due reminders: ${error.message}`, 500);
    return (data ?? []) as DueReminderRow[];
  }

  async markNotified(id: string): Promise<void> {
    const { error } = await this.supabase
      .from("reminders")
      .update({ notified_at: new Date().toISOString() })
      .eq("id", id);

    if (error) throw new AppError(`Failed to mark reminder ${id} as notified: ${error.message}`, 500);
  }

  async getUpcomingReminders(agentId: string, fromDate: string, toDate: string, excludedStatusIds: string[]): Promise<ReminderResponseDTO[] | null> {
    let query = this.supabase
      .from("reminders")
      .select(REMINDER_SELECT)
      .eq("agent_id", agentId)
      .eq("is_active", true)
      .gte("due_date", fromDate)
      .lte("due_date", toDate);

    if (excludedStatusIds.length > 0) {
      query = query.not("status_id", "in", `(${excludedStatusIds.join(",")})`);
    }

    const { data, error } = await query.order("due_date", { ascending: true });
    if (error) {
      console.error("[ReminderRepository.getUpcomingReminders]:", error);
      return null;
    }
    return data as unknown as ReminderResponseDTO[];
  }
}
