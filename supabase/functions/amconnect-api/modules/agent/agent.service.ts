import type { IAgentRepository } from "./agent.repository.ts";
import type { RequestEvidence } from "../../shared/request_evidence.ts";
import type { AgentUpdateDTO, PrivacyConsentDTO, PrivacyStatusDTO } from "./agent.dto.ts";
import { NotFoundError, ValidationError } from "../../shared/errors.ts";
import { objectToCamelCase } from "../../shared/case_converter.ts";
import { PRIVACY_POLICY_URL, PRIVACY_POLICY_VERSION } from "../../shared/legal.ts";

export function buildPrivacyStatus(acceptedVersion: unknown, acceptedAt: unknown): PrivacyStatusDTO {
  const version = typeof acceptedVersion === "string" ? acceptedVersion : null;
  return {
    acceptedVersion: version,
    acceptedAt: typeof acceptedAt === "string" ? acceptedAt : null,
    currentVersion: PRIVACY_POLICY_VERSION,
    url: PRIVACY_POLICY_URL,
    required: version !== PRIVACY_POLICY_VERSION,
  };
}

export class AgentService {
  constructor(private repository: IAgentRepository) {}

  async getMe(agentId: string) {
    const data = await this.repository.findById(agentId);
    if (!data) throw new NotFoundError("Perfil de asesor no encontrado.");
    const { privacyAcceptedVersion, privacyAcceptedAt, ...profile } = objectToCamelCase(data);
    return { ...profile, locale: profile.locale ?? null, privacy: buildPrivacyStatus(privacyAcceptedVersion, privacyAcceptedAt) };
  }

  /** Registra que el asesor aceptó la versión VIGENTE; cualquier otra se rechaza. */
  async acceptPrivacy(agentId: string, consent: PrivacyConsentDTO, evidence: RequestEvidence): Promise<PrivacyStatusDTO> {
    if (consent.version !== PRIVACY_POLICY_VERSION) {
      throw new ValidationError("La versión del aviso de privacidad no es la vigente.");
    }
    await this.repository.recordPrivacyConsent({
      version: consent.version,
      acceptedNotice: consent.acceptedNotice,
      acceptedSensitive: consent.acceptedSensitive,
      evidence,
    });
    const data = await this.repository.findById(agentId);
    if (!data) throw new NotFoundError("Perfil de asesor no encontrado.");
    return buildPrivacyStatus(data.privacy_accepted_version, data.privacy_accepted_at);
  }

  async updateMe(agentId: string, dto: AgentUpdateDTO) {
    const result = await this.repository.update(agentId, {
      fullName: dto.fullName,
      phone: dto.phone,
      locale: dto.locale,
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

  /**
   * Guarda el idioma que reporta el cliente, por la misma razón que el
   * timezone: el cron de recordatorios escribe títulos visibles para el asesor
   * y no tiene request del cual leer `Accept-Language`.
   */
  async syncLocale(agentId: string, locale: string): Promise<void> {
    await this.repository.updateLocale(agentId, locale);
  }
}
