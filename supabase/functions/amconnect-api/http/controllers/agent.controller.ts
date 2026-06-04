import { Context } from "hono";
import { sendSuccess } from "../../shared/api_response.ts";
import { AgentService } from "../../modules/agent/agent.service.ts";
import { AgentUpdateSchema } from "../../modules/agent/agent.dto.ts";

export class AgentController {
  static async getMe(c: Context) {
    const agentId: string = c.get("agent_id");
    const service: AgentService = c.get("services").agentService;
    const data = await service.getMe(agentId);
    return sendSuccess(c, data);
  }

  static async updateMe(c: Context) {
    const agentId: string = c.get("agent_id");
    const body = AgentUpdateSchema.parse(await c.req.json());
    const service: AgentService = c.get("services").agentService;
    const data = await service.updateMe(agentId, body);
    return sendSuccess(c, data);
  }
}
