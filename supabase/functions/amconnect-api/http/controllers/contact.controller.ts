import { Context } from "hono";
import { sendSuccess } from "../../shared/api_response.ts";
import { ContactService } from "../../modules/contact/contact.service.ts";
import { ContactRequestSchema } from "../../modules/contact/contact.dto.ts";
import { NoteService } from "../../modules/note/note.service.ts";
import { validated } from "../middleware/validate.ts";
import { IdParamSchema, NotesSearchQuerySchema, PaginationQuerySchema } from "../routes/route_schemas.ts";

export class ContactController {
  static async getAll(c: Context) {
    const agentId: string = c.get("agent_id");
    const { page, pageSize } = validated(c, "query", PaginationQuerySchema);
    const service: ContactService = c.get("services").contactService;
    const data = await service.paginate({ agent_id: agentId }, page, pageSize);
    return sendSuccess(c, data);
  }

  static async getById(c: Context) {
    const service: ContactService = c.get("services").contactService;
    const data = await service.getById(validated(c, "param", IdParamSchema).id);
    return sendSuccess(c, data);
  }

  static async create(c: Context) {
    const agentId: string = c.get("agent_id");
    const body = ContactRequestSchema.parse(await c.req.json());
    const service: ContactService = c.get("services").contactService;
    const data = await service.create({ ...body, agentId });
    return sendSuccess(c, data, 201);
  }

  static async update(c: Context) {
    const body = ContactRequestSchema.partial().parse(await c.req.json());
    const service: ContactService = c.get("services").contactService;
    const data = await service.update(validated(c, "param", IdParamSchema).id, body);
    return sendSuccess(c, data);
  }

  static async remove(c: Context) {
    const service: ContactService = c.get("services").contactService;
    const data = await service.delete(validated(c, "param", IdParamSchema).id);
    return sendSuccess(c, data);
  }

  static async getNotes(c: Context) {
    const service: NoteService = c.get("services").noteService;
    const { page, pageSize } = validated(c, "query", PaginationQuerySchema);
    return sendSuccess(c, await service.getByContactId(validated(c, "param", IdParamSchema).id, page, pageSize));
  }

  static async getNotesSummary(c: Context) {
    const service: NoteService = c.get("services").noteService;
    const summary = await service.getNotesSummary();
    return sendSuccess(c, summary);
  }

  static async searchNotes(c: Context) {
    const service: NoteService = c.get("services").noteService;
    const { page, pageSize, search } = validated(c, "query", NotesSearchQuerySchema);
    return sendSuccess(c, await service.searchNotes(page, pageSize, search));
  }
}
