import { z } from "zod";
import { SkillDefinition } from "./skill.core.ts";
import { ReminderResponseDTO } from "../../../modules/reminder/reminder.dto.ts";

const slimReminder = (r: ReminderResponseDTO) => ({
  id: r.id,
  title: r.title,
  description: r.description,
  dueDate: r.dueDate,
  isDone: r.isDone,
  contactId: r.contactId,
  policyId: r.policyId,
  type: r.type,
  contact: r.contact,
  policy: r.policy,
});

export const reminderSkills: SkillDefinition[] = [
  {
    domain: "reminder",
    declaration: {
      name: "get_reminder_types",
      description: "Retrieves all available reminder types (e.g., PAYMENT, RENEWAL, FOLLOW_UP, etc.) with their IDs, codes, and names. Call this tool whenever the user asks what types of reminders they can create, or when you need the type_id to create or update a reminder.",
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
      description: "Creates a new reminder for the advisor. Requires type_id — call get_reminder_types first if you don't know it.",
      schema: z.object({
        type_id: z.string({ required_error: "The UUID of the reminder type is required. Call get_reminder_types first to retrieve it." })
          .describe("UUID of the reminder type (obtained from get_reminder_types)"),
        title: z.string({ required_error: "The title of the reminder is required" })
          .describe("Title of the reminder"),
        description: z.string().optional().describe("Additional description or notes for the reminder"),
        due_date: z.string({ required_error: "The due date is required. Use ISO 8601 format with timezone offset matching the advisor's local time (e.g., 2026-06-02T15:00:00-06:00)" })
          .describe("Due date and time in ISO 8601 format with timezone offset matching the advisor's local time (e.g., 2026-06-02T15:00:00-06:00). Must use exactly 'due_date'"),
        contact_id: z.string().optional().describe("UUID of the related contact (optional)"),
        policy_id: z.string().optional().describe("UUID of the related policy (optional)"),
      }),
    },
    async execute(args, ctx) {
      const result = await ctx.reminderService.create({
        agentId: ctx.agentId,
        typeId: args.type_id as string,
        title: args.title as string,
        description: args.description as string ?? null,
        dueDate: args.due_date as string,
        contactId: args.contact_id as string ?? null,
        policyId: args.policy_id as string ?? null,
        isDone: false,
      });
      return result ? slimReminder(result) : null;
    },
  },
  {
    domain: "reminder",
    declaration: {
      name: "get_upcoming_reminders",
      description: "Retrieves the advisor's upcoming reminders (defaults to the next 7 days).",
      schema: z.object({
        days: z.number().optional().describe("Number of days to look ahead (default: 7)"),
      }),
    },
    async execute({ days }, ctx) {
      const reminders = await ctx.reminderService.getUpcoming(ctx.agentId, (days as number) ?? 7);
      return (reminders ?? []).map(slimReminder);
    },
  },
  {
    domain: "reminder",
    declaration: {
      name: "update_reminder",
      description: "Modifies or reschedules an existing reminder. Call get_upcoming_reminders or search first to get the reminder_id.",
      schema: z.object({
        reminder_id: z.string({ required_error: "The UUID of the reminder to update is required" })
          .describe("UUID of the reminder to update"),
        title: z.string().optional(),
        description: z.string().optional(),
        due_date: z.string().optional().describe("New due date in ISO 8601 format with timezone offset matching the advisor's local time (e.g., 2026-06-02T15:00:00-06:00)"),
        type_id: z.string().optional().describe("UUID of the new type (call get_reminder_types if you don't know it)"),
      }),
    },
    async execute(args, ctx) {
      const result = await ctx.reminderService.update(args.reminder_id as string, {
        title: args.title as string | undefined,
        description: args.description as string | undefined,
        dueDate: args.due_date as string | undefined,
        typeId: args.type_id as string | undefined,
      });
      return result ? slimReminder(result) : null;
    },
  },
  {
    domain: "reminder",
    declaration: {
      name: "mark_reminder_done",
      description: "Marks a reminder as completed.",
      schema: z.object({
        reminder_id: z.string({ required_error: "The UUID of the reminder is required" })
          .describe("UUID of the reminder"),
      }),
    },
    async execute({ reminder_id }, ctx) {
      const result = await ctx.reminderService.markDone(reminder_id as string);
      return result ? slimReminder(result) : null;
    },
  },
];
