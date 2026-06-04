import { z } from "zod";
import { SkillDefinition } from "./skill.core.ts";

export const reminderSkills: SkillDefinition[] = [
  {
    domain: "reminder",
    declaration: {
      name: "get_reminder_types",
      description: "Obtiene los tipos de recordatorio disponibles (id, code, name). Llamar antes de create_reminder para obtener el type_id correcto.",
      schema: z.object({}),
    },
    async execute(_args, ctx) {
      return await ctx.catalogServices.reminderTypeService.getAll();
    },
  },
  {
    domain: "reminder",
    declaration: {
      name: "create_reminder",
      description: "Crea un recordatorio. Requiere type_id — usar get_reminder_types primero si no se conoce.",
      schema: z.object({
        type_id: z.string({ required_error: "Se requiere el UUID del tipo de recordatorio. Llamar get_reminder_types primero para obtenerlo." })
          .describe("UUID del tipo de recordatorio (obtenido de get_reminder_types)"),
        title: z.string({ required_error: "El título del recordatorio es obligatorio" })
          .describe("Título del recordatorio"),
        description: z.string().optional().describe("Descripción o notas adicionales"),
        due_date: z.string({ required_error: "La fecha del recordatorio es obligatoria. Usar formato ISO 8601 (ej: 2026-06-02T15:00:00)" })
          .describe("Fecha y hora en formato ISO 8601 (ej: 2026-06-02T15:00:00). Usar exactamente 'due_date'"),
        contact_id: z.string().optional().describe("UUID del contacto relacionado (opcional)"),
        policy_id: z.string().optional().describe("UUID de la póliza relacionada (opcional)"),
      }),
    },
    async execute(args, ctx) {
      return await ctx.reminderService.create({
        agentId: ctx.agentId,
        typeId: args.type_id as string,
        title: args.title as string,
        description: args.description as string ?? null,
        dueDate: args.due_date as string,
        contactId: args.contact_id as string ?? null,
        policyId: args.policy_id as string ?? null,
        isDone: false,
      });
    },
  },
  {
    domain: "reminder",
    declaration: {
      name: "get_upcoming_reminders",
      description: "Obtiene los recordatorios próximos del asesor (por defecto los próximos 7 días).",
      schema: z.object({
        days: z.number().optional().describe("Número de días hacia adelante (default: 7)"),
      }),
    },
    async execute({ days }, ctx) {
      return await ctx.reminderService.getUpcoming(ctx.agentId, (days as number) ?? 7);
    },
  },
  {
    domain: "reminder",
    declaration: {
      name: "update_reminder",
      description: "Modifica o reprograma un recordatorio existente. Usar get_upcoming_reminders o buscar el recordatorio primero para obtener el reminder_id.",
      schema: z.object({
        reminder_id: z.string({ required_error: "Se requiere el UUID del recordatorio a actualizar" })
          .describe("UUID del recordatorio a actualizar"),
        title: z.string().optional(),
        description: z.string().optional(),
        due_date: z.string().optional().describe("Nueva fecha en formato ISO 8601"),
        type_id: z.string().optional().describe("UUID del nuevo tipo (usar get_reminder_types si no se conoce)"),
      }),
    },
    async execute(args, ctx) {
      return await ctx.reminderService.update(args.reminder_id as string, {
        title: args.title as string | undefined,
        description: args.description as string | undefined,
        dueDate: args.due_date as string | undefined,
        typeId: args.type_id as string | undefined,
      });
    },
  },
  {
    domain: "reminder",
    declaration: {
      name: "mark_reminder_done",
      description: "Marca un recordatorio como completado.",
      schema: z.object({
        reminder_id: z.string({ required_error: "Se requiere el UUID del recordatorio" })
          .describe("UUID del recordatorio"),
      }),
    },
    async execute({ reminder_id }, ctx) {
      return await ctx.reminderService.markDone(reminder_id as string);
    },
  },
];
