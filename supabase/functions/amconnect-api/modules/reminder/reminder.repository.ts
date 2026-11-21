import { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseRepository } from "../../core/base_repository.ts";
import { PaginatedResult } from "../../core/repository.interface.ts";
import { ReminderResponseDTO } from "./reminder.dto.ts";
import { AppError, internalError } from "../../shared/errors.ts";
import { handleSupabaseError } from "../../shared/errors.ts";

export interface DueReminderRow {
  id: string;
  title: string;
  description: string | null;
  agent_id: string;
  due_date: string;
  /** Intento de entrega que representa este reclamo (1 = primero). */
  attempts: number;
}

export interface ClaimOptions {
  limit: number;
  leaseSeconds: number;
  maxAttempts: number;
}

/**
 * Métodos del cron de push (`notifications/send-due`). Corren con el cliente de
 * service role. El estado de cada entrega vive en `reminder_push_deliveries`.
 */
export interface INotificationReminderRepository {
  claimDue(options: ClaimOptions): Promise<DueReminderRow[]>;
  /** true si esta llamada fue la que lo marcó (no estaba notificado ni se reagendó). */
  markNotified(id: string, dueDate: string): Promise<boolean>;
  recordDeliveryFailure(id: string, dueDate: string, reason: string, giveUp: boolean): Promise<void>;
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

// Listado: lo que pinta la lista. Sin `notes` (su `content` completo viajaba en
// cada fila y la app no lo lee en la lista); el detalle y las skills sí lo traen.
const REMINDER_LIST_SELECT = `
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
    return super.paginate(
      filters,
      page,
      pageSize,
      { column: "due_date", ascending: true, nullsFirst: false },
      REMINDER_LIST_SELECT,
    );
  }

  /** Detalle: igual que la base pero sin notas dadas de baja (soft delete) en el embed. */
  override async getById(id: string): Promise<ReminderResponseDTO | null> {
    const { data, error } = await this.supabase
      .from("reminders")
      .select(REMINDER_SELECT)
      .eq("id", id)
      .eq("is_active", true)
      .eq("notes.is_active", true)
      .single();

    if (error) handleSupabaseError(error, "reminder.getById");
    return data as unknown as ReminderResponseDTO;
  }

  /**
   * Solo los ids que coinciden con el texto. Existe aparte de `searchReminders`
   * porque el listado paginado no quiere las filas: quiere el conjunto para
   * pasárselo a `paginate` y que la página la arme Postgres, en vez de traerlo
   * todo y recortar en memoria.
   */
  async searchIds(agentId: string, queryText: string): Promise<string[]> {
    const { data, error } = await this.supabase
      .rpc("search_reminder_ids", { p_agent_id: agentId, p_query: queryText });

    // NO devolver [] al fallar: el listado lo leería como "ninguno coincidió" y
    // le diría al asesor que no hay nada, cuando lo que hubo fue un error.
    // Mentirle sobre sus datos es peor que mostrarle una falla.
    if (error) handleSupabaseError(error, "reminder.searchIds");

    return (data ?? []) as unknown as string[];
  }

  async searchReminders(
    agentId: string,
    queryText: string,
    statusCode?: string,
    contactId?: string,
  ): Promise<ReminderResponseDTO[]> {
    let q = this.supabase
      .from("reminders")
      .select(REMINDER_SELECT)
      .eq("agent_id", agentId)
      .eq("is_active", true);

    if (contactId) q = q.eq("contact_id", contactId);
    // Notas dadas de baja no deben aparecer en el embed.
    q = q.eq("notes.is_active", true);

    if (statusCode) {
      const { data: statusData, error: statusError } = await this.supabase
        .from("reminder_statuses")
        .select("id")
        .eq("code", statusCode.toUpperCase())
        .maybeSingle();
      if (statusError) handleSupabaseError(statusError, "reminder.searchReminders.status");
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

      if (idsError) handleSupabaseError(idsError, "reminder.searchReminders.rpc");

      const idList = (ids ?? []) as unknown as string[];
      // Sin coincidencias es una idList vacia, no "sin filtro": omitir el filtro
      // aqui devolveria TODOS los recordatorios como si todos coincidieran.
      if (idList.length === 0) return [];
      q = q.in("id", idList);
    }

    const { data, error } = await q.order("due_date", { ascending: true });
    if (error) handleSupabaseError(error, "reminder.searchReminders");
    return (data ?? []) as unknown as ReminderResponseDTO[];
  }

  // ─── Cron de push ─────────────────────────────────────────────────────────

  /**
   * Reclama de forma atómica los recordatorios vencidos y sin notificar
   * (`claim_due_reminders`, migración 20261121002508). Dos corridas que se
   * traslapan nunca reciben la misma fila.
   */
  async claimDue(options: ClaimOptions): Promise<DueReminderRow[]> {
    const { data, error } = await this.supabase.rpc("claim_due_reminders", {
      p_limit: options.limit,
      p_lease_seconds: options.leaseSeconds,
      p_max_attempts: options.maxAttempts,
    });
    if (error) handleSupabaseError(error, "claim_due_reminders");
    return (data ?? []) as DueReminderRow[];
  }

  async markNotified(id: string, dueDate: string): Promise<boolean> {
    // Condicionado a la fecha reclamada: si el asesor reagendó mientras se
    // enviaba, la fecha nueva sigue pendiente y se avisará a su hora.
    const { data, error } = await this.supabase
      .from("reminders")
      .update({ notified_at: new Date().toISOString() })
      .eq("id", id)
      .eq("due_date", dueDate)
      .is("notified_at", null)
      .select("id");
    if (error) throw internalError("No se pudo marcar el recordatorio como notificado.", `mark notified failed for ${id}: ${error.message}`);

    const { error: deliveryError } = await this.supabase
      .from("reminder_push_deliveries")
      .update({ sent_at: new Date().toISOString(), last_error: null, updated_at: new Date().toISOString() })
      .eq("reminder_id", id)
      .eq("due_date", dueDate);
    if (deliveryError) {
      throw internalError("No se pudo registrar la entrega del push.", `delivery sent update failed for ${id}: ${deliveryError.message}`);
    }

    return (data ?? []).length > 0;
  }

  async recordDeliveryFailure(id: string, dueDate: string, reason: string, giveUp: boolean): Promise<void> {
    // El reclamo (claimed_at) se deja como está: su lease es la espera antes
    // del siguiente intento.
    const now = new Date().toISOString();
    const { error } = await this.supabase
      .from("reminder_push_deliveries")
      .update({ last_error: reason, gave_up_at: giveUp ? now : null, updated_at: now })
      .eq("reminder_id", id)
      .eq("due_date", dueDate);
    if (error) throw internalError("No se pudo registrar la falla del push.", `delivery failure update failed for ${id}: ${error.message}`);
  }

  async logNotification(reminderId: string, agentId: string, dueDate: string): Promise<void> {
    const { error } = await this.supabase
      .from("reminder_notifications")
      .insert({ reminder_id: reminderId, agent_id: agentId, due_date_at_send: dueDate });

    if (error) throw internalError("No se pudo registrar el log de notificación.", `log notification failed for ${reminderId}: ${error.message}`);
  }

  /**
   * `fromDate`/`toDate` en null es "sin ese limite", no un error: cuando la
   * pregunta va acotada a un cliente no hay ventana que valga. Un recordatorio
   * de Julio dentro de tres meses sigue siendo un pendiente de Julio, y
   * recortarlo a los proximos 7 dias lo esconde sin decirlo.
   */
  async getUpcomingReminders(
    agentId: string,
    fromDate: string | null,
    toDate: string | null,
    excludedStatusIds: string[],
    contactId?: string,
  ): Promise<ReminderResponseDTO[]> {
    let query = this.supabase
      .from("reminders")
      .select(REMINDER_SELECT)
      .eq("agent_id", agentId)
      .eq("is_active", true);

    query = query.eq("notes.is_active", true);
    if (fromDate) query = query.gte("due_date", fromDate);
    if (toDate) query = query.lte("due_date", toDate);
    if (contactId) query = query.eq("contact_id", contactId);

    if (excludedStatusIds.length > 0) {
      query = query.not("status_id", "in", `(${excludedStatusIds.join(",")})`);
    }

    const { data, error } = await query.order("due_date", { ascending: true });
    // Lanzar, no devolver null: el asistente leería "sin recordatorios".
    if (error) handleSupabaseError(error, "reminder.getUpcomingReminders");
    return (data ?? []) as unknown as ReminderResponseDTO[];
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
  /**
   * Cuantos recordatorios pendientes quedan ANTES de una fecha.
   *
   * Hermano de `countPendingAfter`, y hacia el lado que faltaba. Medido el
   * 2026-09-04: "que tengo pendiente de Zarah el proximo mes" contestaba que en
   * octubre no habia nada y se callaba el del domingo siguiente, porque caia
   * antes de la ventana y nadie lo miraba. En la pregunta general el mismo
   * hueco esconde lo VENCIDO, que es lo mas urgente de la agenda.
   *
   * `head: true` — solo el conteo.
   */
  async countPendingBefore(
    agentId: string,
    beforeDate: string,
    excludedStatusIds: string[],
    contactId?: string,
  ): Promise<number> {
    let query = this.supabase
      .from("reminders")
      .select("id", { count: "exact", head: true })
      .eq("agent_id", agentId)
      .eq("is_active", true)
      .lt("due_date", beforeDate);

    if (excludedStatusIds.length > 0) {
      query = query.not("status_id", "in", `(${excludedStatusIds.join(",")})`);
    }
    if (contactId) query = query.eq("contact_id", contactId);

    const { count, error } = await query;
    // Un conteo fallido NO es 0: el aviso de "quedan N pendientes" se callaría.
    if (error) handleSupabaseError(error, "reminder.countPendingBefore");
    return count ?? 0;
  }

  async countPendingAfter(
    agentId: string,
    afterDate: string,
    excludedStatusIds: string[],
    contactId?: string,
  ): Promise<number> {
    let query = this.supabase
      .from("reminders")
      .select("id", { count: "exact", head: true })
      .eq("agent_id", agentId)
      .eq("is_active", true)
      .gt("due_date", afterDate);

    // El aviso de "quedan N mas alla de la ventana" tiene que contar lo mismo
    // que se listo. Sin este filtro, una pregunta por Julio avisaria de
    // pendientes de otros clientes.
    if (contactId) query = query.eq("contact_id", contactId);

    if (excludedStatusIds.length > 0) {
      query = query.not("status_id", "in", `(${excludedStatusIds.join(",")})`);
    }

    const { count, error } = await query;
    // Un conteo fallido NO es 0: el aviso de "quedan N pendientes" se callaría.
    if (error) handleSupabaseError(error, "reminder.countPendingAfter");
    return count ?? 0;
  }
}
