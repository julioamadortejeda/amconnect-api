import { z } from "zod";
import { SkillDefinition } from "./skill.core.ts";
import { ReminderResponseDTO } from "../../../modules/reminder/reminder.dto.ts";

const slimReminder = (r: ReminderResponseDTO) => ({
  id: r.id,
  title: r.title,
  description: r.description,
  dueDate: r.dueDate,
  statusId: r.statusId,
  status: r.status,
  comments: r.comments,
  contactId: r.contactId,
  policyId: r.policyId,
  type: r.type,
  contact: r.contact,
  policy: r.policy,
});

const STATUS_UPDATE_DESC = "New status code for the reminder. Call get_reminder_statuses first to get the list of valid codes from the database before using this field.";
const STATUS_FILTER_DESC = "Filter by status code. Call get_reminder_statuses first to get the list of valid codes from the database.";

export const reminderSkills: SkillDefinition[] = [
  {
    domain: "reminder",
    declaration: {
      name: "get_reminder_statuses",
      description: "Retrieves all available reminder status codes with their IDs and names from the database. Only call this if the user explicitly asks about available statuses or if you encounter an unfamiliar status code.",
      schema: z.object({}),
    },
    async execute(_args, ctx) {
      return await ctx.catalogServices.reminderStatusService.getAll();
    },
  },
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
      description: "Creates a new general reminder or task (not assigned to a specific client, or optionally assigned via contact_id). CRITICAL: Do not aggressively or automatically search for, resolve, or link a contact_id or policy_id to the reminder unless the user explicitly asks to associate it with a client or policy. If the user asks for a personal reminder or simple task (e.g. 'recuerdame enviar documentacion de mi poliza RC'), leave contact_id and policy_id as undefined. Only use them when explicitly requested. If the title or description are not explicitly provided by the user, you must intelligently generate an appropriate title (a very short summary like 'Llamar a Juan', 'Ir a junta') and a detailed description/summary from the context of what the advisor requested. Status is automatically set to CREATED.",
      schema: z.object({
        type_id: z.string().optional().describe("UUID of the reminder type (obtained from get_reminder_types)"),
        reminder_type_id: z.string().optional().describe("Alternative name for type_id (UUID of the reminder type)"),
        reminder_type_name_or_code: z.string().optional().describe("Code or name of the reminder type. Call get_reminder_types to see all available types and their codes. Infer the best match from the user's message. Defaults to OTHER if omitted."),
        title: z.string().optional()
          .describe("A very short, summarized title of the reminder (e.g., 'Llamar a Julio', 'Ir a junta'). If not provided, generate a concise short title matching this style based on the user request."),
        description: z.string().optional()
          .describe("Detailed description or notes for the reminder. You must always generate a detailed description outlining the context/purpose of the reminder based on what the user requested if they did not provide one."),
        due_date: z.string({ required_error: "The due date is required. Use ISO 8601 format with timezone offset matching the advisor's local time (e.g., 2026-06-02T15:00:00-06:00)" })
          .describe("Due date and time in ISO 8601 format with timezone offset matching the advisor's local time (e.g., 2026-06-02T15:00:00-06:00). Must use exactly 'due_date'"),
        contact_id: z.string().optional().describe("UUID of the related contact. ONLY provide this if the user explicitly requested to link a specific client, otherwise leave undefined."),
        policy_id: z.string().optional().describe("UUID of the related policy. ONLY provide this if the user explicitly requested to link a specific policy, otherwise leave undefined."),
        comment: z.string().optional().describe("Optional initial comment containing the complete details/message requested by the user (e.g. 'le urge el presupuesto')."),
      }),
    },
    async execute(args, ctx) {
      const params = args as any;
      let typeId = params.type_id || params.reminder_type_id;

      if (!typeId) {
        const types = await ctx.catalogServices.reminderTypeService.getAll();
        if (types) {
          const typeQuery = (params.reminder_type_name_or_code || "OTHER").toUpperCase().trim();
          const byCode = types.find(t => String(t.code).toUpperCase() === typeQuery);
          if (byCode) {
            typeId = byCode.id as string;
          } else {
            const byName = types.find(t => String(t.name).toUpperCase().includes(typeQuery));
            typeId = byName ? (byName.id as string) : (types.find(t => t.code === "OTHER")?.id as string ?? types[0]?.id as string);
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
        comment: args.comment as string ?? null,
      });
      return result ? slimReminder(result) : null;
    },
  },
  {
    domain: "reminder",
    declaration: {
      name: "get_upcoming_reminders",
      description: "Retrieves the advisor's upcoming reminders (defaults to the next 7 days). Only returns pending or in progress reminders.",
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
      description: "Modifies, updates status, adds comments, or reschedules an existing reminder. Call get_upcoming_reminders or search first to get the reminder_id. CRITICAL: When the user asks to add details, updates, or notes to an existing reminder (e.g. 'agrégale que...', 'escribe que...'), do NOT append this to the 'description'. Keep the 'description' as a concise summary, and pass the new details/notes into the 'comment' parameter so they are logged in the history.",
      schema: z.object({
        reminder_id: z.string({ required_error: "The UUID of the reminder to update is required" })
          .describe("UUID of the reminder to update"),
        title: z.string().optional().describe("Short summarized title (e.g. 'Llamar a Julio')"),
        description: z.string().optional().describe("Concise summary of the task. Do NOT bloat or append follow-up details here; use the 'comment' parameter instead."),
        due_date: z.string().optional().describe("New due date in ISO 8601 format with timezone offset matching the advisor's local time (e.g., 2026-06-02T15:00:00-06:00)"),
        type_id: z.string().optional().describe("UUID of the new type (call get_reminder_types if you don't know it)"),
        status: z.string().optional().describe(`${STATUS_UPDATE_DESC} If setting to CANCELLED, a comment is MANDATORY.`),
        comment: z.string().optional().describe("Any follow-up details, notes, updates, or additions requested by the user. Pass the complete text of the new update/note here."),
      }),
    },
    async execute(args, ctx) {
      const params = args as any;
      if (params.status === "CANCELLED" && (!params.comment || !params.comment.trim())) {
        return { error: "El comentario es obligatorio para cancelar un recordatorio. Por favor, solicita o proporciona un comentario explicativo." };
      }
      const result = await ctx.reminderService.update(params.reminder_id as string, {
        title: params.title as string | undefined,
        description: params.description as string | undefined,
        dueDate: params.due_date as string | undefined,
        typeId: params.type_id as string | undefined,
        status: params.status as string | undefined,
        comment: params.comment as string | undefined,
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
        comment: z.string().optional().describe("Optional completion comment"),
      }),
    },
    async execute({ reminder_id, comment }, ctx) {
      const result = await ctx.reminderService.update(reminder_id as string, {
        status: "DONE",
        comment: comment as string | undefined,
      });
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
      description: "Searches for reminders by text matching in title or description, optionally allowing filtering by status code.",
      schema: z.object({
        query: z.string().describe("Text to search for in title or description"),
        status: z.string().optional().describe(STATUS_FILTER_DESC),
      }),
    },
    async execute({ query, status }, ctx) {
      const items = await ctx.reminderService.searchReminders(ctx.agentId, query as string, status as string | undefined);
      return (items ?? []).map(slimReminder);
    },
  },
  {
    domain: "reminder",
    declaration: {
      name: "create_reminder_for_client",
      description: "Creates a reminder for the advisor assigning it to a specific client by directly resolving their name. Use when the user asks to schedule tasks or reminders mentioning the client (e.g., 'remind me to call Julio tomorrow'). If the title or description are not explicitly provided by the user, you must intelligently generate an appropriate title (short, action-oriented) and a detailed description/summary from the context of what the advisor requested. Status is automatically set to CREATED.",
      schema: z.object({
        client_name: z.string({ required_error: "Name of the client to assign the reminder to" }).describe("Name of the client"),
        title: z.string().optional()
          .describe("Title of the reminder. If not provided, intelligently generate a concise, action-oriented title based on the user request."),
        due_date: z.string({ required_error: "Due date in ISO 8601 format with the advisor's local offset (e.g., 2026-06-02T15:00:00-06:00)" }).describe("Due date and time with offset (e.g., YYYY-MM-DDTHH:mm:ss-06:00)"),
        description: z.string().optional()
          .describe("Detailed description or notes for the reminder. You must always intelligently generate a suitable description summarizing the context/purpose of the reminder based on what the user requested if they did not provide one."),
        reminder_type_name_or_code: z.string().optional().describe("Code or name of the reminder type. Call get_reminder_types to see all available types and their codes. Infer the best match from the user's message. Defaults to OTHER if omitted."),
        comment: z.string().optional().describe("Optional initial comment"),
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
        const typeQuery = (params.reminder_type_name_or_code || "OTHER").toUpperCase().trim();
        const byCode = types.find(t => String(t.code).toUpperCase() === typeQuery);
        if (byCode) {
          typeId = byCode.id as string;
        } else {
          const byName = types.find(t => String(t.name).toUpperCase().includes(typeQuery));
          typeId = byName ? (byName.id as string) : (types.find(t => t.code === "OTHER")?.id as string ?? types[0]?.id as string);
        }
      }

      const reminder = await ctx.reminderService.create({
        agentId: ctx.agentId,
        typeId,
        title: params.title as string,
        description: params.description || null,
        dueDate: params.due_date,
        contactId: contacts[0].id,
        comment: params.comment ?? null,
      });

      return reminder ? slimReminder(reminder) : null;
    },
  },
];
