import { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import { ContactService } from "../../../modules/contact/contact.service.ts";
import { PolicyService } from "../../../modules/policy/policy.service.ts";
import { ReminderService } from "../../../modules/reminder/reminder.service.ts";
import { RagService } from "../../rag/rag.service.ts";
import { CatalogServices } from "../../../modules/catalog/catalog.service.ts";

export interface SkillContext {
  agentId: string;
  sessionId: string;
  supabase: SupabaseClient;
  contactService: ContactService;
  policyService: PolicyService;
  reminderService: ReminderService;
  ragService: RagService;
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
