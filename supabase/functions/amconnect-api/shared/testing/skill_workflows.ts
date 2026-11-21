// Monta los workflow services REALES (los que tienen las reglas de negocio de
// las skills) sobre los services de módulo que ya trae un SkillContext de
// prueba, igual que lo hace el DI en producción con los verdaderos.
import type { SkillContext } from "../../features/ai_chat/skills/skill.core.ts";
import { ContactWorkflowService } from "../../modules/contact/contact_workflow.service.ts";
import { PolicyWorkflowService } from "../../modules/policy/policy_workflow.service.ts";
import { ReminderWorkflowService } from "../../modules/reminder/reminder_workflow.service.ts";
import { PolicyConfirmationService } from "../../features/document_processing/policy_confirmation.service.ts";

export function withRealWorkflows(ctx: SkillContext): SkillContext {
  const contactWorkflow = new ContactWorkflowService(ctx.contactService, ctx.usageService, ctx.knowledgeIngestionService);
  ctx.contactWorkflow = contactWorkflow;
  ctx.policyWorkflow = new PolicyWorkflowService(ctx.policyService, ctx.contactService, ctx.catalogServices);
  ctx.reminderWorkflow = new ReminderWorkflowService(ctx.reminderService, contactWorkflow, ctx.catalogServices);
  ctx.policyConfirmation = new PolicyConfirmationService(
    ctx.policyService,
    ctx.contactService,
    ctx.catalogServices,
    ctx.embeddingsService,
    ctx.aiSessionService,
    ctx.reminderGenerationService,
  );
  return ctx;
}
