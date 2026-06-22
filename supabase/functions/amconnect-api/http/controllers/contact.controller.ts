import { Context } from "hono";
import { sendSuccess } from "../../shared/api_response.ts";
import { ContactService } from "../../modules/contact/contact.service.ts";
import { ContactRequestSchema } from "../../modules/contact/contact.dto.ts";
import { NoteRepository } from "../../modules/note/note.repository.ts";
import { AppError } from "../../shared/errors.ts";
import { parsePagination } from "../../shared/pagination.ts";

export class ContactController {
  static async getAll(c: Context) {
    const agentId: string = c.get("agent_id");
    const { page, pageSize } = parsePagination(c);
    const service: ContactService = c.get("services").contactService;
    const data = await service.paginate({ agent_id: agentId }, page, pageSize);
    return sendSuccess(c, data);
  }

  static async getById(c: Context) {
    const service: ContactService = c.get("services").contactService;
    const data = await service.getById(c.req.param("id") as string);
    return sendSuccess(c, data);
  }

  static async search(c: Context) {
    const agentId: string = c.get("agent_id");
    const query = c.req.query("q");
    if (!query) throw new AppError("Parámetro 'q' requerido.", 400);
    const service: ContactService = c.get("services").contactService;
    const data = await service.findSimilarContact(agentId, query);
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
    const data = await service.update(c.req.param("id") as string, body);
    return sendSuccess(c, data);
  }

  static async remove(c: Context) {
    const service: ContactService = c.get("services").contactService;
    const data = await service.delete(c.req.param("id") as string);
    return sendSuccess(c, data);
  }

  static async getNotes(c: Context) {
    const repo: NoteRepository = c.get("services").noteRepository;
    const notes = await repo.getByContactId(c.req.param("id") as string);
    return sendSuccess(c, { data: notes });
  }

  static async getRecentNotes(c: Context) {
    const repo: NoteRepository = c.get("services").noteRepository;
    const limit = Math.min(parseInt(c.req.query("limit") ?? "20", 10), 50);
    const notes = await repo.getRecent(limit);
    return sendSuccess(c, { data: notes });
  }

  static async getNotesSummary(c: Context) {
    const repo: NoteRepository = c.get("services").noteRepository;
    const summary = await repo.getNotesSummary();
    return sendSuccess(c, summary);
  }

  static async searchNotes(c: Context) {
    const repo: NoteRepository = c.get("services").noteRepository;
    const limit = Math.min(parseInt(c.req.query("limit") ?? "20", 10), 50);
    const search = c.req.query("search");
    const notes = await repo.searchNotes(limit, search);
    return sendSuccess(c, { data: notes });
  }
}
