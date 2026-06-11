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
      description: "Creates a new general reminder (not assigned to a specific client, or optionally assigned via contact_id). Resolves the type_id automatically from 'reminder_type_name_or_code' or 'reminder_type_id' if provided.",
      schema: z.object({
        type_id: z.string().optional().describe("UUID of the reminder type (obtained from get_reminder_types)"),
        reminder_type_id: z.string().optional().describe("Alternative name for type_id (UUID of the reminder type)"),
        reminder_type_name_or_code: z.string().optional().describe("Alternative code or name of the reminder type (e.g. 'CALL', 'Llamada', 'Pago')"),
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
      const params = args as any;
      let typeId = params.type_id || params.reminder_type_id;

      if (!typeId) {
        const types = await ctx.catalogServices.reminderTypeService.getAll();
        if (types) {
          const typeQuery = (params.reminder_type_name_or_code || "CALL").toUpperCase().trim();
          const byCode = types.find(t => String(t.code).toUpperCase() === typeQuery);
          if (byCode) {
            typeId = byCode.id as string;
          } else {
            const byName = types.find(t => String(t.name).toUpperCase().includes(typeQuery));
            typeId = byName ? (byName.id as string) : (types.find(t => t.code === "CALL")?.id as string ?? types[0]?.id as string);
          }
        }
      }

      if (!typeId) {
        return { error: "Could not resolve reminder type. Make sure to pass 'type_id' or 'reminder_type_name_or_code'." };
      }

      const result = await ctx.reminderService.create({
        agentId: ctx.agentId,
        typeId: typeId as string,
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
  {
    domain: "reminder",
    declaration: {
      name: "delete_reminder",
      description: "Deletes (logical delete) a reminder by its ID. ALWAYS list or search reminders first to confirm the reminder_id.",
      schema: z.object({
        reminder_id: z.string({ required_error: "The UUID of the reminder to delete is required" })
          .describe("UUID of the reminder to delete"),
      }),
    },
    async execute({ reminder_id }, ctx) {
      const result = await ctx.reminderService.delete(reminder_id as string);
      return result ? { success: true, message: `Reminder '${result.title}' deleted successfully.` } : { success: false, error: "Could not find the reminder to delete." };
    },
  },
  {
    domain: "reminder",
    declaration: {
      name: "search_reminders",
      description: "Searches for reminders by text matching in title or description, optionally allowing filtering by whether they are completed or not.",
      schema: z.object({
        query: z.string().describe("Text to search for in title or description"),
        is_done: z.boolean().optional().describe("Filter by completed (true) or pending (false)"),
      }),
    },
    async execute({ query, is_done }, ctx) {
      const items = await ctx.reminderService.searchReminders(ctx.agentId, query as string, is_done as boolean | undefined);
      return (items ?? []).map(slimReminder);
    },
  },
  {
    domain: "reminder",
    declaration: {
      name: "create_reminder_for_client",
      description: "Creates a reminder for the advisor assigning it to a specific client by directly resolving their name. Use when the user asks to schedule tasks or reminders mentioning the client (e.g., 'remind me to call Julio tomorrow'). Resolves the reminder type (e.g., CALL for 'call', APPOINTMENT for 'meeting') automatically.",
      schema: z.object({
        client_name: z.string({ required_error: "Name of the client to assign the reminder to" }).describe("Name of the client"),
        title: z.string({ required_error: "Title of the reminder" }).describe("Title of the reminder"),
        due_date: z.string({ required_error: "Due date in ISO 8601 format with the advisor's local offset (e.g., 2026-06-02T15:00:00-06:00)" }).describe("Due date and time with offset (e.g., YYYY-MM-DDTHH:mm:ss-06:00)"),
        description: z.string().optional().describe("Additional description"),
        reminder_type_name_or_code: z.string().optional().describe("Code or name of the reminder type (e.g., 'CALL', 'Llamada', 'Pago'). Defaults to 'Llamada' if not specified."),
      }),
    },
    async execute(args, ctx) {
      const params = args as any;
      const contacts = await ctx.contactService.findSimilarContact(ctx.agentId, params.client_name);
      if (!contacts || contacts.length === 0) {
        return { error: `No client found matching '${params.client_name}'.` };
      }
      if (contacts.length > 1) {
        return {
          error: `Multiple clients found matching '${params.client_name}'. Please be more specific.`,
          matches: contacts.map(c => ({ id: c.id, fullName: c.fullName }))
        };
      }

      const types = await ctx.catalogServices.reminderTypeService.getAll();
      let typeId = "";
      if (types) {
        const typeQuery = (params.reminder_type_name_or_code || "CALL").toUpperCase().trim();
        const byCode = types.find(t => String(t.code).toUpperCase() === typeQuery);
        if (byCode) {
          typeId = byCode.id as string;
        } else {
          const byName = types.find(t => String(t.name).toUpperCase().includes(typeQuery));
          typeId = byName ? (byName.id as string) : (types.find(t => t.code === "CALL")?.id as string ?? types[0]?.id as string);
        }
      }

      const reminder = await ctx.reminderService.create({
        agentId: ctx.agentId,
        typeId,
        title: params.title,
        description: params.description ?? null,
        dueDate: params.due_date,
        contactId: contacts[0].id,
        isDone: false,
      });

      return reminder ? slimReminder(reminder) : null;
    },
  },
];
