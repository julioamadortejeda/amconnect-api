import { Context } from "hono";
import { sendSuccess } from "../../shared/api_response.ts";
import { SubscriptionService } from "../../modules/subscription/subscription.service.ts";
import { ApplyPromoSchema } from "../../modules/subscription/subscription.dto.ts";
import { AppError } from "../../shared/errors.ts";

export class SubscriptionController {
  static async getInfo(c: Context) {
    const agentId: string = c.get("agent_id");
    const service: SubscriptionService = c.get("subscription_service");
    const info = await service.getSubscriptionInfo(agentId);
    return sendSuccess(c, info);
  }

  static async getPlans(c: Context) {
    const service: SubscriptionService = c.get("subscription_service");
    const plans = await service.getPlans();
    return sendSuccess(c, plans);
  }

  static async applyPromo(c: Context) {
    const agentId: string = c.get("agent_id");
    const body = ApplyPromoSchema.safeParse(await c.req.json());
    if (!body.success) throw new AppError("Se requiere el campo 'code'.", 400);

    const service: SubscriptionService = c.get("subscription_service");
    const result = await service.applyPromoCode(agentId, body.data.code);
    return sendSuccess(c, result);
  }
}
