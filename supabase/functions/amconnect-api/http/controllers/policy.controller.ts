import { Context } from "hono";
import { sendSuccess } from "../../shared/api_response.ts";
import { PolicyService } from "../../modules/policy/policy.service.ts";
import { PolicyRequestSchema, PolicyParticipantSchema, BeneficiarySchema, PolicyNoteCreateSchema } from "../../modules/policy/policy.dto.ts";
import { NoteService } from "../../modules/note/note.service.ts";
import { validated } from "../middleware/validate.ts";
import { ContactIdParamSchema, IdParamSchema, PaginationQuerySchema } from "../routes/route_schemas.ts";

export class PolicyController {
  static async getAll(c: Context) {
    const agentId: string = c.get("agent_id");
    const { page, pageSize } = validated(c, "query", PaginationQuerySchema);
    const service: PolicyService = c.get("services").policyService;
    const data = await service.paginate({ agent_id: agentId }, page, pageSize);
    return sendSuccess(c, data);
  }

  static async getByContact(c: Context) {
    const service: PolicyService = c.get("services").policyService;
    const { contactId } = validated(c, "param", ContactIdParamSchema);
    const { page, pageSize } = validated(c, "query", PaginationQuerySchema);
    const data = await service.paginate({ contact_id: contactId }, page, pageSize);
    return sendSuccess(c, data);
  }

  static async getById(c: Context) {
    const service: PolicyService = c.get("services").policyService;
    const { id } = validated(c, "param", IdParamSchema);
    const [policy, participants, beneficiaries] = await Promise.all([
      service.getById(id),
      service.getParticipants(id),
      service.getBeneficiaries(id),
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
    const data = await service.update(validated(c, "param", IdParamSchema).id, body);
    return sendSuccess(c, data);
  }

  static async remove(c: Context) {
    const service: PolicyService = c.get("services").policyService;
    const data = await service.delete(validated(c, "param", IdParamSchema).id);
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

  static async addNote(c: Context) {
    const agentId: string = c.get("agent_id");
    const policyId = validated(c, "param", IdParamSchema).id;
    const { content } = PolicyNoteCreateSchema.parse(await c.req.json());
    const { policyService, embeddingsService } = c.get("services");
    const data = await (policyService as PolicyService).addNote(agentId, policyId, content, embeddingsService);
    return sendSuccess(c, data, 201);
  }

  static async getNotes(c: Context) {
    const policyId = validated(c, "param", IdParamSchema).id;
    const { page, pageSize } = validated(c, "query", PaginationQuerySchema);
    const service: NoteService = c.get("services").noteService;
    return sendSuccess(c, await service.getByPolicyId(policyId, page, pageSize));
  }

  static async deleteNote(c: Context) {
    const agentId: string = c.get("agent_id");
    const noteId = validated(c, "param", IdParamSchema).id;
    const service: NoteService = c.get("services").noteService;
    await service.deleteNote(agentId, noteId);
    return sendSuccess(c, { deleted: true });
  }
}
