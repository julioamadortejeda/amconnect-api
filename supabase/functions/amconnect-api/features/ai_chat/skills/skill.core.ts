import { z } from "zod";
import { ContactService } from "../../../modules/contact/contact.service.ts";
import { PolicyService } from "../../../modules/policy/policy.service.ts";
import { ReminderService } from "../../../modules/reminder/reminder.service.ts";
import { ReminderGenerationService } from "../../../modules/reminder/reminder_generation.service.ts";
import { ReminderSettingService } from "../../../modules/reminder/reminder_setting.service.ts";
import { RagService } from "../../rag/rag.service.ts";
import { EmbeddingsService } from "../../rag/embeddings.service.ts";
import { KnowledgeIngestionService } from "../../document_processing/knowledge_ingestion.service.ts";
import { AiSessionService } from "../ai_session.service.ts";
import { CatalogServices } from "../../../modules/catalog/catalog.service.ts";
import { UsageService } from "../../../modules/subscription/usage.service.ts";

export interface SkillContext {
  agentId: string;
  sessionId: string;
  timezone: string;
  timezoneOffset: string;
  contactService: ContactService;
  knowledgeIngestionService: KnowledgeIngestionService;
  usageService: UsageService;
  policyService: PolicyService;
  reminderService: ReminderService;
  reminderGenerationService: ReminderGenerationService;
  reminderSettingService: ReminderSettingService;
  ragService: RagService;
  embeddingsService: EmbeddingsService;
  aiSessionService: AiSessionService;
  catalogServices: CatalogServices;
}

/**
 * Truena si una skill de actualización no recibió un solo campo que cambiar.
 *
 * Sin esto, una actualización vacía es INDISTINGUIBLE de una exitosa: los
 * services no escriben nada cuando el payload queda vacío, pero igual
 * devuelven el registro completo y sin errores. El modelo ve un objeto válido
 * y le confirma al asesor un cambio que nunca ocurrió — pasó el 2026-08-13 con
 * "ponlo en progreso" sobre un recordatorio, que siguió en CREATED.
 *
 * Al lanzar, `executeSkill` responde con el sobre `ok: false` + la instrucción
 * de no reportarlo como hecho.
 *
 * [fields] son los campos que para ESA skill cuentan como cambio — no siempre
 * son los que llegan a la tabla: en recordatorios un `comment` solo no toca la
 * fila pero sí inserta un comentario, así que cuenta.
 */
export function assertHasChanges(fields: Record<string, unknown>): void {
  const hasAny = Object.values(fields).some((v) =>
    v !== undefined && !(typeof v === "string" && v.trim() === "")
  );
  if (!hasAny) {
    throw new Error(
      "Nothing to update: no field to change was provided. Ask the advisor what exactly " +
        "they want to change, then call this skill again including that field.",
    );
  }
}

export interface SkillDefinition {
  domain: string;
  declaration: {
    name: string;
    description: string;
    schema: z.ZodObject<z.ZodRawShape>;
  };
  execute: (args: Record<string, unknown>, ctx: SkillContext) => Promise<unknown>;
}
