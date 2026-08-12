import type { IAgentRepository } from "./agent.repository.ts";
import type { AgentUpdateDTO } from "./agent.dto.ts";
import { NotFoundError } from "../../shared/errors.ts";
import { objectToCamelCase } from "../../shared/case_converter.ts";

export class AgentService {
  constructor(private repository: IAgentRepository) {}

  async getMe(agentId: string) {
    const data = await this.repository.findById(agentId);
    if (!data) throw new NotFoundError("Perfil de asesor no encontrado.");
    return objectToCamelCase(data);
  }

  async updateMe(agentId: string, dto: AgentUpdateDTO) {
    const result = await this.repository.update(agentId, {
      fullName: dto.fullName,
      phone: dto.phone,
    });
    return objectToCamelCase(result as Record<string, unknown>);
  }

  /**
   * Guarda la zona horaria que reporta el cliente. El cron de generación de
   * recordatorios no tiene request del cual leerla, así que depende de esto
   * para calcular la medianoche local correcta de cada asesor.
   */
  async syncTimezone(agentId: string, timezone: string): Promise<void> {
    await this.repository.updateTimezone(agentId, timezone);
  }
}
