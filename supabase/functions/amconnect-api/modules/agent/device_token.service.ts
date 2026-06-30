import { IDeviceTokenRepository } from "./device_token.repository.ts";
import { ISubscriptionRepository } from "../subscription/subscription.repository.ts";
import { objectToCamelCase } from "../../shared/case_converter.ts";
import { DeviceTokenResponseDTO } from "./device_token.dto.ts";

export class DeviceTokenService {
  constructor(
    private deviceTokenRepo: IDeviceTokenRepository,
    private subscriptionRepo: ISubscriptionRepository
  ) {}

  async registerToken(
    agentId: string,
    token: string,
    platform: "android" | "ios" | "web"
  ): Promise<DeviceTokenResponseDTO> {
    // 1. Obtener la información del plan del asesor para saber su límite de dispositivos
    let maxDevices = 1;
    try {
      const planInfo = await this.subscriptionRepo.getAgentWithPlan(agentId);
      if (planInfo?.plan?.limits) {
        maxDevices = planInfo.plan.limits.max_devices ?? 1;
      }
    } catch (err) {
      console.error("[DeviceTokenService.registerToken] Error fetching plan limits:", err);
      // Fallback a 1 dispositivo si falla
    }

    // 2. Hacer upsert del token del dispositivo
    const data = await this.deviceTokenRepo.upsert(agentId, token, platform);

    // 3. Aplicar límite de dispositivos (borrar los más antiguos si se excede el límite)
    await this.deviceTokenRepo.deleteOldestTokens(agentId, maxDevices);

    return objectToCamelCase(data as Record<string, unknown>) as unknown as DeviceTokenResponseDTO;
  }

  async removeToken(token: string): Promise<void> {
    await this.deviceTokenRepo.deleteByToken(token);
  }
}
