import { Context } from "hono";
import { sendSuccess } from "../../shared/api_response.ts";
import { ReminderService } from "../../modules/reminder/reminder.service.ts";
import { ReminderRequestSchema } from "../../modules/reminder/reminder.dto.ts";
import { NoteService } from "../../modules/note/note.service.ts";
import { validated } from "../middleware/validate.ts";
import { IdParamSchema, PaginationQuerySchema, RemindersQuerySchema } from "../routes/route_schemas.ts";

export class ReminderController {
  static async getAll(c: Context) {
    const agentId: string = c.get("agent_id");
    // ?policyId= acota al historial de una póliza (incluye los ya cerrados).
    const { page, pageSize, policyId, query } = validated(c, "query", RemindersQuerySchema);
    // ?query= busca por VARIAS palabras, sin acentos y en cualquier orden
    // (search_reminder_ids). Se resuelve a ids y se paginan: la página la arma
    // Postgres, no el cliente. Ver la nota del filtro por arreglo en
    // core/base_repository.ts.
    const filters: Record<string, unknown> = { agent_id: agentId };
    if (policyId) filters.policy_id = policyId;
    const service: ReminderService = c.get("services").reminderService;
    if (query) filters.id = await service.searchIds(agentId, query);
    const data = await service.paginate(filters, page, pageSize);
    return sendSuccess(c, data);
  }

  static async getById(c: Context) {
    const service: ReminderService = c.get("services").reminderService;
    const data = await service.getById(validated(c, "param", IdParamSchema).id);
    return sendSuccess(c, data);
  }

  static async create(c: Context) {
    const agentId: string = c.get("agent_id");
    const body = ReminderRequestSchema.parse(await c.req.json());
    const service: ReminderService = c.get("services").reminderService;
    const data = await service.create({ ...body, agentId });
    return sendSuccess(c, data, 201);
  }

  static async update(c: Context) {
    const body = ReminderRequestSchema.partial().parse(await c.req.json());
    const service: ReminderService = c.get("services").reminderService;
    const data = await service.update(validated(c, "param", IdParamSchema).id, body);
    return sendSuccess(c, data);
  }

  static async markDone(c: Context) {
    const service: ReminderService = c.get("services").reminderService;
    const data = await service.markDone(validated(c, "param", IdParamSchema).id);
    return sendSuccess(c, data);
  }

  static async remove(c: Context) {
    const service: ReminderService = c.get("services").reminderService;
    const data = await service.delete(validated(c, "param", IdParamSchema).id);
    return sendSuccess(c, data);
  }

  static async getNotes(c: Context) {
    const service: NoteService = c.get("services").noteService;
    const { page, pageSize } = validated(c, "query", PaginationQuerySchema);
    return sendSuccess(c, await service.getByReminderId(validated(c, "param", IdParamSchema).id, page, pageSize));
  }
}
