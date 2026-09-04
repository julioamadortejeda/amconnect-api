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
import { CommitmentService } from "../../commitments/commitment.service.ts";

export interface SkillContext {
  agentId: string;
  sessionId: string;
  timezone: string;
  timezoneOffset: string;
  /**
   * TODO lo que el asesor ha escrito en esta conversación, para las skills que
   * verifican que el modelo copió sus palabras en vez de inventarlas.
   *
   * La conversación entera y no el último mensaje: entre que el asesor dice la
   * frase y el modelo tiene lo que necesita para guardarla pueden pasar varios
   * turnos —"¿cuál de los dos Julios?" / "al segundo"— y contra ese "al segundo"
   * no coincide ninguna cita. Verificar solo el turno actual hacía imposible
   * cualquier registro que necesitara una aclaración.
   *
   * Solo turnos del asesor: si entrara lo que dijo el modelo, podría citarse a
   * sí mismo y la verificación no verificaría nada.
   *
   * Opcional porque en voz no existe: el contexto se arma una vez al abrir la
   * sesión, no por turno. Quien lo use tiene que funcionar sin él.
   */
  advisorWords?: string;
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
  commitmentService: CommitmentService;
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
