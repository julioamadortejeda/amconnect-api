import { z } from "zod";
import { SkillDefinition } from "./skill.core.ts";

export const pendingTaskSkills: SkillDefinition[] = [
  {
    domain: "pending_task",
    declaration: {
      name: "save_pending_task",
      description: "Saves a pending task when information is missing to complete an action (e.g., ambiguity in contact, missing data). Call before asking the user for clarification.",
      schema: z.object({
        task_type: z.string({ required_error: "The type of the pending action is required (e.g., update_contact, create_reminder)" })
          .describe("Type of pending action (e.g., update_contact, create_reminder, update_reminder)"),
        payload: z.record(z.string(), z.unknown())
          .describe("Data already gathered for the action (what is known so far)"),
        missing: z.array(z.string())
          .describe("List of fields or information missing to complete the action"),
      }),
    },
    async execute(args, ctx) {
      const pendingTaskId = await ctx.aiSessionService.savePendingTask(
        ctx.sessionId,
        ctx.agentId,
        args.task_type as string,
        { ...(args.payload as object), missing: args.missing },
      );
      return { pending_task_id: pendingTaskId };
    },
  },
  {
    domain: "pending_task",
    declaration: {
      name: "resolve_pending_task",
      description: "Marks a pending task as resolved/completed after obtaining the missing information and executing the action.",
      schema: z.object({
        pending_task_id: z.string({ required_error: "The UUID of the pending task to resolve is required" })
          .describe("UUID of the pending task to resolve"),
      }),
    },
    async execute(args, ctx) {
      await ctx.aiSessionService.resolvePendingTask(args.pending_task_id as string, ctx.sessionId);
      // Solo el hecho. Que esto sea puro bookkeeping y que no cuente como
      // registro es politica constante y vive en READING TOOL RESULTS.
      //
      // Que la regla exista se debe a esto: una fila de `ai_pending_tasks` se
      // parece demasiado a un registro de verdad —trae task_type
      // "create_commitment", contact_id y descripcion— y el modelo la toma por
      // el guardado. Comprobado el 2026-08-28: hizo save_pending_task +
      // resolve_pending_task, no llamo a create_commitment, y le confirmo al
      // asesor un compromiso inexistente.
      return { resolved: true };
    },
  },
];
