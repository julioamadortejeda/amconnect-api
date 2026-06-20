import { Context } from "hono";
import { sendSuccess } from "../../shared/api_response.ts";
import { PolicyService } from "../../modules/policy/policy.service.ts";
import { PolicyRequestSchema, PolicyParticipantSchema, BeneficiarySchema } from "../../modules/policy/policy.dto.ts";
import { parsePagination } from "../../shared/pagination.ts";
import { NoteRepository } from "../../modules/note/note.repository.ts";
import { AppError } from "../../shared/errors.ts";

export class PolicyController {
  static async getAll(c: Context) {
    const agentId: string = c.get("agent_id");
    const { page, pageSize } = parsePagination(c);
    const service: PolicyService = c.get("services").policyService;
    const data = await service.paginate({ agent_id: agentId }, page, pageSize);
    return sendSuccess(c, data);
  }

  static async getByContact(c: Context) {
    const service: PolicyService = c.get("services").policyService;
    const data = await service.getByField("contact_id", c.req.param("contactId") as string);
    return sendSuccess(c, data);
  }

  static async getById(c: Context) {
    const service: PolicyService = c.get("services").policyService;
    const [policy, participants, beneficiaries] = await Promise.all([
      service.getById(c.req.param("id") as string),
      service.getParticipants(c.req.param("id") as string),
      service.getBeneficiaries(c.req.param("id") as string),
    ]);
    return sendSuccess(c, { policy, participants, beneficiaries });
  }

  static async create(c: Context) {
    const agentId: string = c.get("agent_id");
    const body = PolicyRequestSchema.parse(await c.req.json());
    const service: PolicyService = c.get("services").policyService;
    const data = await service.create({ ...body, agentId });
    return sendSuccess(c, data, 201);
  }

  static async update(c: Context) {
    const body = PolicyRequestSchema.partial().parse(await c.req.json());
    const service: PolicyService = c.get("services").policyService;
    const data = await service.update(c.req.param("id") as string, body);
    return sendSuccess(c, data);
  }

  static async remove(c: Context) {
    const service: PolicyService = c.get("services").policyService;
    const data = await service.delete(c.req.param("id") as string);
    return sendSuccess(c, data);
  }

  static async addParticipant(c: Context) {
    const body = PolicyParticipantSchema.parse(await c.req.json());
    const service: PolicyService = c.get("services").policyService;
    const data = await service.addParticipant(body as never);
    return sendSuccess(c, data, 201);
  }

  static async addBeneficiary(c: Context) {
    const body = BeneficiarySchema.parse(await c.req.json());
    const service: PolicyService = c.get("services").policyService;
    const data = await service.addBeneficiary(body as never);
    return sendSuccess(c, data, 201);
  }

  static async getNotes(c: Context) {
    const policyId = c.req.param("id") as string;
    const repo = new NoteRepository(c.get("supabase"));
    const notes = await repo.getByPolicyId(policyId);
    return sendSuccess(c, { data: notes });
  }

  static async deleteNote(c: Context) {
    const agentId: string = c.get("agent_id");
    const noteId = c.req.param("id") as string;
    if (!noteId) throw new AppError("El parámetro 'id' es requerido.", 400);
    const repo = new NoteRepository(c.get("supabase"));
    await repo.deleteNote(agentId, noteId);
    return sendSuccess(c, { deleted: true });
  }
}
