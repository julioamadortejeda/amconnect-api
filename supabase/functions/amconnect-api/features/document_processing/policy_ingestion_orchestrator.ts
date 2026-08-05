import { AiChatService } from "../ai_chat/ai_chat.service.ts";
import { AiSessionService } from "../ai_chat/ai_session.service.ts";
import { UsageService } from "../../modules/subscription/usage.service.ts";
import { AI_MODEL } from "../../shared/config.ts";
import { compensateIngestionFailure } from "../../shared/ingestion_compensation.ts";
import { PolicyExtraction } from "./policy_extraction.schema.ts";
import { PolicyIngestInput, PolicyIngestionService } from "./policy_ingestion.service.ts";

export type PolicyIngestionResult =
  | {
    status: "contact_mismatch";
    sessionId: string;
    contactMismatch: unknown;
  }
  | {
    status: "ingested";
    sessionId: string;
    message: string;
    documentMetadataId: string | null;
    extraction: PolicyExtraction;
    isDuplicate: boolean;
  };

export interface ResolveContactMismatchResult {
  sessionId: string;
  message: string;
  documentMetadataId: string | null;
  extraction: PolicyExtraction;
  isDuplicate: false;
}

/**
 * Orquesta la saga de ingesta de una póliza: crea la sesión de IA, extrae los
 * datos del documento, resuelve duplicados/contact-mismatch, y arranca la
 * sesión de chat de confirmación. Si algo falla a mitad de camino, compensa
 * (revierte cuota / marca o borra la sesión) según el tipo de error — ver
 * `compensateIngestionFailure` en shared/.
 *
 * Extraído de AiController.ingestPolicy/resolveContactMismatch (RULES §1: los
 * controllers no orquestan lógica de negocio) — misma secuencia de llamadas a
 * los mismos services, mismo manejo de errores, solo reubicado. El tracking
 * de tokens/ai_session/summary vive intacto dentro de AiSessionService,
 * PolicyIngestionService y AiChatService — este orquestador no los toca, solo
 * los invoca en el mismo orden que antes.
 */
export class PolicyIngestionOrchestrator {
  constructor(
    private aiSessionService: AiSessionService,
    private policyIngestionService: PolicyIngestionService,
    private aiChatService: AiChatService,
    private usageService: UsageService,
  ) {}

  async ingestPolicy(agentId: string, input: PolicyIngestInput): Promise<PolicyIngestionResult> {
    await this.usageService.checkAndIncrementIngestion(agentId);

    const sessionId = await this.aiSessionService.createSession(agentId, {
      triggerMessage: "policy_ingestion",
      sessionType: "policy_ingestion",
      modelName: AI_MODEL,
    });

    try {
      const ingestResult = await this.policyIngestionService.extract(agentId, sessionId, input);

      if (ingestResult.status === "contact_mismatch") {
        // No arrancamos el chat de confirmación todavía — se pausa hasta que
        // el asesor resuelva vía resolveContactMismatch (sin costo de IA extra).
        return {
          status: "contact_mismatch",
          sessionId,
          contactMismatch: ingestResult.contactMismatch,
        };
      }

      let text: string;
      if (ingestResult.status === "duplicate_detected") {
        const response = await this.aiChatService.startPolicyUpdateSession(
          sessionId,
          agentId,
          ingestResult.extraction,
          ingestResult.existingPolicyId!,
          ingestResult.diff!,
        );
        text = response.text;
      } else {
        const response = await this.aiChatService.startPolicySession(
          sessionId,
          agentId,
          ingestResult.extraction,
          ingestResult.documentMetadataId,
        );
        text = response.text;
      }

      return {
        status: "ingested",
        sessionId,
        message: text,
        documentMetadataId: ingestResult.documentMetadataId || null,
        extraction: ingestResult.extraction,
        isDuplicate: ingestResult.status === "duplicate_detected",
      };
    } catch (err) {
      await compensateIngestionFailure(err, this.aiSessionService, this.usageService, agentId, sessionId);
      throw err;
    }
  }

  // Resuelve la pregunta sí/no de contact_mismatch. No es un turno de chat con
  // el modelo — es una decisión determinística sobre la misma sesión ya creada
  // por ingestPolicy. Tras persistirla, arranca el chat de confirmación normal
  // (mismo call que el camino sin conflicto). Sin compensación propia — igual
  // que en el controller original, un fallo aquí propaga tal cual al
  // globalErrorHandler.
  async resolveContactMismatch(
    agentId: string,
    sessionId: string,
    assignToScreenContact: boolean,
  ): Promise<ResolveContactMismatchResult> {
    const { extraction, documentMetadataId } = await this.policyIngestionService.resolveContactMismatch(
      agentId,
      sessionId,
      assignToScreenContact,
    );

    const response = await this.aiChatService.startPolicySession(sessionId, agentId, extraction, documentMetadataId);

    return {
      sessionId,
      message: response.text,
      documentMetadataId: documentMetadataId || null,
      extraction,
      isDuplicate: false,
    };
  }
}
