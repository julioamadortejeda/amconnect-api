import { SupabaseClient } from "@supabase/supabase-js";
import { BaseService } from "../../core/base_service.ts";
import { SupabaseRepository } from "../../core/base_repository.ts";
import { ReminderRequestDTO, ReminderResponseDTO } from "./reminder.dto.ts";
import { objectToCamelCaseDeep, stripUndefined } from "../../shared/case_converter.ts";

const REMINDER_SELECT = `
  *,
  type:reminder_types(id, name, code),
  contact:contacts(id, full_name),
  policy:policies(id, policy_number)
`.trim();

export class ReminderService extends BaseService<ReminderRequestDTO, ReminderResponseDTO> {
  private reminderRepo: SupabaseRepository<ReminderResponseDTO>;

  constructor(supabase: SupabaseClient) {
    const repo = new SupabaseRepository<ReminderResponseDTO>(supabase, "reminders", REMINDER_SELECT);
    super(repo);
    this.reminderRepo = repo;
  }

  private toDTO(row: unknown): ReminderResponseDTO {
    return objectToCamelCaseDeep(row) as ReminderResponseDTO;
  }

  override async getAll(limit = 100) {
    const rows = await this.repository.getAll(limit);
    return rows ? rows.map((r) => this.toDTO(r)) : null;
  }

  override async getById(id: string) {
    const row = await this.repository.getById(id);
    return row ? this.toDTO(row) : null;
  }

  override async getByField(field: string, value: unknown, limit = 100) {
    const rows = await this.repository.getByField(field, value, limit);
    return rows ? rows.map((r) => this.toDTO(r)) : null;
  }

  override async create(data: Partial<ReminderRequestDTO>) {
    const row = await this.repository.create(this.prepareForCreate(data) as Partial<ReminderResponseDTO>);
    return row ? this.toDTO(row) : null;
  }

  override async update(id: string, data: Partial<ReminderRequestDTO>) {
    const row = await this.repository.update(id, this.prepareForUpdate(id, data) as Partial<ReminderResponseDTO>);
    return row ? this.toDTO(row) : null;
  }

  override async delete(id: string) {
    const row = await this.repository.delete(id);
    return row ? this.toDTO(row) : null;
  }

  protected override prepareForCreate(data: Partial<ReminderRequestDTO>): Record<string, unknown> {
    return {
      agent_id: data.agentId,
      contact_id: data.contactId ?? null,
      policy_id: data.policyId ?? null,
      type_id: data.typeId,
      title: data.title,
      description: data.description ?? null,
      due_date: data.dueDate,
      is_done: data.isDone ?? false,
    };
  }

  protected override prepareForUpdate(_id: string, data: Partial<ReminderRequestDTO>): Record<string, unknown> {
    return stripUndefined({
      contact_id: data.contactId,
      policy_id: data.policyId,
      type_id: data.typeId,
      title: data.title,
      description: data.description,
      due_date: data.dueDate,
      is_done: data.isDone,
    });
  }

  async markDone(id: string): Promise<ReminderResponseDTO | null> {
    const row = await this.repository.update(id, { is_done: true } as never);
    return row ? this.toDTO(row) : null;
  }

  // TODO: mover el filtro de fecha a la DB — findByFilters solo soporta igualdad (.eq),
  // habría que añadir soporte de rangos (.gte/.lte) al repo base o una query directa aquí,
  // para no traer todos los reminders del agente en memoria antes de filtrar.
  async getUpcoming(agentId: string, days = 7): Promise<ReminderResponseDTO[] | null> {
    const from = new Date().toISOString();
    const to = new Date(Date.now() + days * 86400000).toISOString();
    const items = await this.reminderRepo.findByFilters({ agent_id: agentId, is_done: false });
    if (!items) return null;
    return items
      .map((r) => this.toDTO(r))
      .filter((r) => r.dueDate >= from && r.dueDate <= to);
  }
}
