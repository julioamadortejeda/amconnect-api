import { BaseService } from "../../core/base_service.ts";
import { ReminderRequestDTO, ReminderResponseDTO } from "./reminder.dto.ts";
import { ReminderRepository } from "./reminder.repository.ts";
import { objectToCamelCaseDeep, stripUndefined } from "../../shared/case_converter.ts";
import { AppError } from "../../shared/errors.ts";
import { daysFromNowRange } from "../../shared/utils.ts";

export class ReminderService extends BaseService<ReminderRequestDTO, ReminderResponseDTO> {
  private reminderRepo: ReminderRepository;

  constructor(repository: ReminderRepository) {
    super(repository);
    this.reminderRepo = repository;
  }

  protected override toDTO(row: unknown): ReminderResponseDTO {
    return objectToCamelCaseDeep(row) as ReminderResponseDTO;
  }

  override async create(data: Partial<ReminderRequestDTO>): Promise<ReminderResponseDTO | null> {
    let statusId = data.statusId;
    if (!statusId) {
      const statusCode = (data.status || "CREATED").toUpperCase();
      const { data: statusData } = await this.reminderRepo.client
        .from("reminder_statuses")
        .select("id")
        .eq("code", statusCode)
        .single();
      if (!statusData) {
        throw new AppError(`Estado '${statusCode}' no válido`, 400);
      }
      statusId = statusData.id;
    }

    const prepared = {
      agent_id: data.agentId,
      contact_id: data.contactId ?? null,
      policy_id: data.policyId ?? null,
      type_id: data.typeId,
      title: data.title,
      description: data.description ?? null,
      due_date: data.dueDate,
      status_id: statusId,
    };

    // deno-lint-ignore no-explicit-any
    const row = await this.repository.create(prepared as any);
    if (row && data.comment && data.comment.trim()) {
      const { error: commentErr } = await this.reminderRepo.client
        .from("reminder_comments")
        .insert({
          reminder_id: row.id,
          agent_id: data.agentId,
          content: data.comment.trim(),
        });
      if (commentErr) {
        console.error("[ReminderService.create] Error saving comment:", commentErr.message);
      }
    }
    return row ? this.getById(row.id) : null;
  }

  override async update(id: string, data: Partial<ReminderRequestDTO>): Promise<ReminderResponseDTO | null> {
    const existing = await this.getById(id);
    if (!existing) {
      throw new AppError("Recordatorio no encontrado", 404);
    }

    const updatePayload: Record<string, unknown> = {};

    let targetStatusId = data.statusId;
    let targetStatusCode = "";

    if (data.status) {
      const code = data.status.toUpperCase();
      const { data: statusData } = await this.reminderRepo.client
        .from("reminder_statuses")
        .select("id, code")
        .eq("code", code)
        .single();
      if (!statusData) {
        throw new AppError(`Estado '${code}' no válido`, 400);
      }
      targetStatusId = statusData.id;
      targetStatusCode = statusData.code;
    } else if (data.statusId) {
      const { data: statusData } = await this.reminderRepo.client
        .from("reminder_statuses")
        .select("id, code")
        .eq("id", data.statusId)
        .single();
      if (!statusData) {
        throw new AppError("statusId no válido", 400);
      }
      targetStatusId = statusData.id;
      targetStatusCode = statusData.code;
    }

    if (targetStatusId) {
      updatePayload.status_id = targetStatusId;
    }

    if (!targetStatusCode && existing.status) {
      targetStatusCode = existing.status.code;
    }

    if (targetStatusCode === "CANCELLED") {
      if (!data.comment || !data.comment.trim()) {
        throw new AppError("El comentario es obligatorio para cancelar un recordatorio", 400);
      }
    }

    if (data.comment && data.comment.trim()) {
      const { error: commentErr } = await this.reminderRepo.client
        .from("reminder_comments")
        .insert({
          reminder_id: id,
          agent_id: existing.agentId,
          content: data.comment.trim(),
        });
      if (commentErr) {
        console.error("[ReminderService.update] Error saving comment:", commentErr.message);
      }
    }

    if (data.contactId !== undefined) updatePayload.contact_id = data.contactId;
    if (data.policyId !== undefined) updatePayload.policy_id = data.policyId;
    if (data.typeId !== undefined) updatePayload.type_id = data.typeId;
    if (data.title !== undefined) updatePayload.title = data.title;
    if (data.description !== undefined) updatePayload.description = data.description;
    if (data.dueDate !== undefined) {
      updatePayload.due_date = data.dueDate;
      // Reagendar debe volver a hacer al recordatorio elegible para el cron
      // de notificaciones — si no, notified_at sigue seteado de la fecha
      // vieja y findDueUnnotified() lo excluye para siempre.
      if (new Date(data.dueDate).getTime() !== new Date(existing.dueDate).getTime()) {
        updatePayload.notified_at = null;
      }
    }

    if (Object.keys(updatePayload).length > 0) {
      // deno-lint-ignore no-explicit-any
      await this.repository.update(id, updatePayload as any);
    }
    return this.getById(id);
  }

  async markDone(id: string): Promise<ReminderResponseDTO | null> {
    const { data: statusData } = await this.reminderRepo.client
      .from("reminder_statuses")
      .select("id")
      .eq("code", "DONE")
      .single();
    if (!statusData) {
      throw new AppError("Estado DONE no encontrado en base de datos", 500);
    }
    // deno-lint-ignore no-explicit-any
    const row = await this.repository.update(id, { status_id: statusData.id } as any);
    return row ? this.toDTO(row) : null;
  }

  /**
   * Tres valores distintos en las fechas, a proposito:
   * `undefined` = nadie pidio ventana, se aplica el default de 7 dias.
   * `null`      = sin limite por ese lado, decidido por quien llama.
   * una fecha   = esa.
   *
   * La diferencia importa desde que se puede preguntar por un cliente: ahi la
   * respuesta correcta es todo lo que le queda pendiente, no lo de esta semana.
   */
  async getUpcoming(
    agentId: string,
    fromDate?: string | null,
    toDate?: string | null,
    contactId?: string,
  ): Promise<ReminderResponseDTO[] | null> {
    const defaultRange = daysFromNowRange(7);
    const from = fromDate === undefined ? defaultRange.from : fromDate;
    const to = toDate === undefined ? defaultRange.to : toDate;

    const excludedIds = await this.excludedStatusIds();
    const items = await this.reminderRepo.getUpcomingReminders(agentId, from, to, excludedIds, contactId);
    return items ? items.map((r) => this.toDTO(r)) : null;
  }

  /**
   * Cuantos pendientes quedan mas alla de la ventana consultada. Lo usa
   * `get_upcoming_reminders` para no presentar una lista recortada como si
   * fuera toda la agenda.
   */
  async countPendingAfter(agentId: string, afterDate: string, contactId?: string): Promise<number> {
    const excludedIds = await this.excludedStatusIds();
    return await this.reminderRepo.countPendingAfter(agentId, afterDate, excludedIds, contactId);
  }

  /**
   * Cuantos pendientes quedan ANTES de la ventana consultada. Con la ventana
   * por defecto —que arranca "ahora"— esto es exactamente lo vencido.
   */
  async countPendingBefore(agentId: string, beforeDate: string, contactId?: string): Promise<number> {
    const excludedIds = await this.excludedStatusIds();
    return await this.reminderRepo.countPendingBefore(agentId, beforeDate, excludedIds, contactId);
  }

  /** DONE y CANCELLED no son pendientes: fuera de listados y de conteos. */
  private async excludedStatusIds(): Promise<string[]> {
    const { data } = await this.reminderRepo.client
      .from("reminder_statuses")
      .select("id")
      .in("code", ["DONE", "CANCELLED"]);
    return data ? data.map((s) => s.id) : [];
  }

  /** Ids que coinciden con el texto, para el listado paginado. */
  async searchIds(agentId: string, queryText: string): Promise<string[]> {
    return await this.reminderRepo.searchIds(agentId, queryText);
  }

  async searchReminders(
    agentId: string,
    queryText: string,
    statusCode?: string,
    contactId?: string,
  ): Promise<ReminderResponseDTO[] | null> {
    const items = await this.reminderRepo.searchReminders(agentId, queryText, statusCode, contactId);
    return items ? items.map((r) => this.toDTO(r)) : null;
  }
}
