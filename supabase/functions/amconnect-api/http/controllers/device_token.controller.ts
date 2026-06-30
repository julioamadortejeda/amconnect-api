import { Context } from "hono";
import { sendSuccess } from "../../shared/api_response.ts";
import { DeviceTokenRegisterSchema } from "../../modules/agent/device_token.dto.ts";

export class DeviceTokenController {
  static async registerToken(c: Context) {
    const agentId: string = c.get("agent_id");
    const body = DeviceTokenRegisterSchema.parse(await c.req.json());
    // deno-lint-ignore no-explicit-any
    const service = (c.get("services") as any).deviceTokenService;
    const data = await service.registerToken(agentId, body.token, body.platform);
    return sendSuccess(c, data);
  }

  static async deregisterToken(c: Context) {
    const body = await c.req.json();
    const token = body.token;
    // deno-lint-ignore no-explicit-any
    const service = (c.get("services") as any).deviceTokenService;
    await service.removeToken(token);
    return sendSuccess(c, { success: true });
  }
}
