import { z } from "zod";
import { ContactService } from "../../../modules/contact/contact.service.ts";
import { PolicyService } from "../../../modules/policy/policy.service.ts";
import { ReminderService } from "../../../modules/reminder/reminder.service.ts";
import { ReminderGenerationService } from "../../../modules/reminder/reminder_generation.service.ts";
import { RagService } from "../../rag/rag.service.ts";
import { EmbeddingsService } from "../../rag/embeddings.service.ts";
import { AiSessionService } from "../ai_session.service.ts";
import { CatalogServices } from "../../../modules/catalog/catalog.service.ts";

export interface SkillContext {
  agentId: string;
  sessionId: string;
  contactService: ContactService;
  policyService: PolicyService;
  reminderService: ReminderService;
  reminderGenerationService: ReminderGenerationService;
  ragService: RagService;
  embeddingsService: EmbeddingsService;
  aiSessionService: AiSessionService;
  catalogServices: CatalogServices;
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
