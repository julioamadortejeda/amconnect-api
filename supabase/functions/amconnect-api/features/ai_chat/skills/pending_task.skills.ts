import { z } from "zod";
import { SkillDefinition } from "./skill.core.ts";

export const pendingTaskSkills: SkillDefinition[] = [
  {
    domain: "pending_task",
    declaration: {
      name: "save_pending_task",
      description: "Guarda una tarea pendiente cuando falta información para completar una acción (ej: ambigüedad en el contacto, datos faltantes). Llamar antes de preguntarle al usuario.",
      schema: z.object({
        task_type: z.string({ required_error: "Se requiere el tipo de acción pendiente (ej: update_contact, create_reminder)" })
          .describe("Tipo de acción pendiente (ej: update_contact, create_reminder, update_reminder)"),
        payload: z.record(z.string(), z.unknown())
          .describe("Datos ya recopilados para la acción (lo que se sabe hasta ahora)"),
        missing: z.array(z.string())
          .describe("Lista de campos o información que falta para completar la acción"),
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
      description: "Marca una tarea pendiente como completada después de obtener la información faltante y ejecutar la acción.",
      schema: z.object({
        pending_task_id: z.string({ required_error: "Se requiere el UUID de la tarea pendiente a resolver" })
          .describe("UUID de la tarea pendiente a resolver"),
      }),
    },
    async execute(args, ctx) {
      await ctx.aiSessionService.resolvePendingTask(args.pending_task_id as string, ctx.sessionId);
      return { resolved: true };
    },
  },
];
