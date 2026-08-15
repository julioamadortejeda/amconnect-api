import { Context } from "hono";
import { sendSuccess } from "../../shared/api_response.ts";
import { SubscriptionService } from "../../modules/subscription/subscription.service.ts";
import { ApplyPromoSchema } from "../../modules/subscription/subscription.dto.ts";

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
    // Schema.parse: el ZodError lo formatea el globalErrorHandler (RULES §2).
    const { code } = ApplyPromoSchema.parse(await c.req.json());

    const service: SubscriptionService = c.get("subscription_service");
    const result = await service.applyPromoCode(agentId, code);
    return sendSuccess(c, result);
  }
}
