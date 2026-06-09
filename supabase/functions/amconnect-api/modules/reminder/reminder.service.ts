import { BaseService } from "../../core/base_service.ts";
import { ReminderRequestDTO, ReminderResponseDTO } from "./reminder.dto.ts";
import { ReminderRepository } from "./reminder.repository.ts";
import { objectToCamelCaseDeep, stripUndefined } from "../../shared/case_converter.ts";

export class ReminderService extends BaseService<ReminderRequestDTO, ReminderResponseDTO> {
  constructor(repository: ReminderRepository) {
    super(repository);
  }

  protected override toDTO(row: unknown): ReminderResponseDTO {
    return objectToCamelCaseDeep(row) as ReminderResponseDTO;
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
  // habría que añadir soporte de rangos (.gte/.lte) al repo base o una query directa aquí.
  async getUpcoming(agentId: string, days = 7): Promise<ReminderResponseDTO[] | null> {
    const from = new Date().toISOString();
    const to = new Date(Date.now() + days * 86400000).toISOString();
    const items = await this.repository.findByFilters({ agent_id: agentId, is_done: false });
    if (!items) return null;
    return items
      .map((r) => this.toDTO(r))
      .filter((r) => r.dueDate >= from && r.dueDate <= to);
  }
}
