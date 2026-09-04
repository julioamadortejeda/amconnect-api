import { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseRepository } from "../../core/base_repository.ts";
import { PaginatedResult } from "../../core/repository.interface.ts";
import { ReminderResponseDTO } from "./reminder.dto.ts";
import { AppError, internalError } from "../../shared/errors.ts";

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
  logNotification(reminderId: string, agentId: string, dueDate: string): Promise<void>;
}

const REMINDER_SELECT = `
  *,
  type:reminder_types(id, name, code),
  status:reminder_statuses(id, name, code),
  comments:reminder_comments(id, reminder_id, agent_id, content, created_at),
  notes:agent_notes(id, content, summary, source_type, created_at, document_metadata(file_name, storage_path)),
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

    // Los ids salen de search_reminder_ids y no de un `ilike` aqui porque
    // `ilike` NO ignora acentos: el asesor teclea "diagnostico" sin acento y el
    // recordatorio dice "diagnóstico", y la busqueda devolvia cero en silencio
    // (migracion 20260903030000). El select de arriba se queda intacto — la
    // funcion solo decide QUE filas, no que columnas.
    if (queryText) {
      const { data: ids, error: idsError } = await this.supabase
        .rpc("search_reminder_ids", { p_agent_id: agentId, p_query: queryText });

      if (idsError) {
        console.error("[ReminderRepository.searchReminders] rpc:", idsError);
        return null;
      }

      const lista = (ids ?? []) as unknown as string[];
      // Sin coincidencias es una lista vacia, no "sin filtro": omitir el filtro
      // aqui devolveria TODOS los recordatorios como si todos coincidieran.
      if (lista.length === 0) return [];
      q = q.in("id", lista);
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
      throw internalError("No se pudieron cargar los estados de recordatorio.", `reminder_statuses load failed: ${statusErr?.message}`);
    }

    const { data, error } = await this.supabase
      .from("reminders")
      .select("id, title, description, agent_id, due_date")
      .eq("is_active", true)
      .in("status_id", statuses.map((s) => s.id))
      .lte("due_date", nowStr)
      .is("notified_at", null);

    if (error) throw internalError("No se pudieron cargar los recordatorios vencidos.", `due reminders load failed: ${error.message}`);
    return (data ?? []) as DueReminderRow[];
  }

  async markNotified(id: string): Promise<void> {
    const { error } = await this.supabase
      .from("reminders")
      .update({ notified_at: new Date().toISOString() })
      .eq("id", id);

    if (error) throw internalError("No se pudo marcar el recordatorio como notificado.", `mark notified failed for ${id}: ${error.message}`);
  }

  async logNotification(reminderId: string, agentId: string, dueDate: string): Promise<void> {
    const { error } = await this.supabase
      .from("reminder_notifications")
      .insert({ reminder_id: reminderId, agent_id: agentId, due_date_at_send: dueDate });

    if (error) throw internalError("No se pudo registrar el log de notificación.", `log notification failed for ${reminderId}: ${error.message}`);
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

  /**
   * Cuantos recordatorios pendientes quedan DESPUES de una fecha.
   *
   * Existe para que `get_upcoming_reminders` pueda decir que su ventana por
   * defecto recorto algo. Sin este numero, "que tengo pendiente" contestaba con
   * los proximos 7 dias y se veia igual de completa que la respuesta completa:
   * un recordatorio a 12 dias simplemente no aparecia y nadie se enteraba.
   *
   * `head: true` — solo interesa el conteo, no traer las filas.
   */
  async countPendingAfter(
    agentId: string,
    afterDate: string,
    excludedStatusIds: string[],
  ): Promise<number> {
    let query = this.supabase
      .from("reminders")
      .select("id", { count: "exact", head: true })
      .eq("agent_id", agentId)
      .eq("is_active", true)
      .gt("due_date", afterDate);

    if (excludedStatusIds.length > 0) {
      query = query.not("status_id", "in", `(${excludedStatusIds.join(",")})`);
    }

    const { count, error } = await query;
    if (error) {
      console.error("[ReminderRepository.countPendingAfter]:", error);
      return 0;
    }
    return count ?? 0;
  }
}
