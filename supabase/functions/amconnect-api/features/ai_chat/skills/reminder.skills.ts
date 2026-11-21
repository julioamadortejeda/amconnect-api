import { z } from "zod";
import { nothingToUpdate, SkillDefinition } from "./skill.core.ts";
import { entityThreshold } from "../../rag/rag.service.ts";
import { agendaResult, reminderCreatedResult, slimReminder } from "./reminder.mapper.ts";
import { clientNotResolved } from "./contact.mapper.ts";

const STATUS_UPDATE_DESC = "New status for the reminder — its code or its UUID, both are accepted. Call get_reminder_statuses first to get the catalog.";
// Lo mismo para `create_reminder` y `create_reminder_for_client`: el catálogo
// de tipos no se pudo leer o está vacío.
const TYPE_UNRESOLVED = {
  error: "Could not resolve reminder type. Make sure to pass 'type_id' or 'reminder_type_name_or_code'.",
};
const STATUS_FILTER_DESC = "Filter by status — its code or its UUID, both are accepted. Call get_reminder_statuses first to get the catalog.";

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
      description: "Retrieves all available reminder types with their IDs, codes, and names. Call this tool BEFORE create_reminder or create_reminder_for_client whenever you don't already know the correct type_id/code from earlier in this same conversation — do not guess or default to OTHER without checking the actual catalog first, since new types may exist beyond what you already know.",
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
      description: "Creates a new general reminder or task (not assigned to a specific client, or optionally assigned via contact_id). A reminder is pinned to ONE specific day and alerts the advisor, so it needs that day: if the advisor gave a fuzzy window ('en unos días', 'la próxima semana', 'en diciembre') or no date at all, do NOT ask them to pick one — use create_commitment instead. CRITICAL: Do not aggressively or automatically search for, resolve, or link a contact_id or policy_id to the reminder unless the user explicitly asks to associate it with a client or policy. Pronouns like 'me', 'mi', 'mis', 'tengo que', 'recuérdame' signal a personal/general task — keep contact_id and policy_id undefined in that case. If the user asks for a personal reminder or simple task (e.g. 'recuerdame enviar documentacion de mi poliza RC'), leave contact_id and policy_id as undefined. Only use them when explicitly requested. If the title or description are not explicitly provided by the user, you must intelligently generate an appropriate title (a very short summary like 'Llamar a Juan', 'Ir a junta') and a detailed description/summary from the context of what the advisor requested. Status is automatically set to CREATED.",
      schema: z.object({
        type_id: z.string().optional().describe("UUID of the reminder type (obtained from get_reminder_types)"),
        reminder_type_id: z.string().optional().describe("Alternative name for type_id (UUID of the reminder type)"),
        reminder_type_name_or_code: z.string().optional().describe("Code or name of the reminder type, matched against the real catalog. Call get_reminder_types first if you don't already know the codes from earlier in this conversation, then pick the code that best matches the user's message (e.g. 'dar seguimiento' -> a follow-up type). Only fall back to a generic/OTHER type after checking the catalog and finding no better match."),
        title: z.string().optional()
          .describe("A very short, summarized title of the reminder (e.g., 'Llamar a Julio', 'Ir a junta'). If not provided, generate a concise short title matching this style based on the user request."),
        description: z.string().optional()
          .describe("Detailed description or notes for the reminder. You must always generate a detailed description outlining the context/purpose of the reminder based on what the user requested if they did not provide one."),
        due_date: z.string({ required_error: "The due date is required." })
          .describe("Due date and time in ISO 8601 format with timezone offset matching the advisor's local time (e.g., 2026-06-02T15:00:00-06:00). Must use exactly 'due_date'"),
        contact_id: z.string().optional().describe("UUID of the related contact. ONLY provide this if the user explicitly requested to link a specific client, otherwise leave undefined."),
        policy_id: z.string().optional().describe("UUID of the related policy. ONLY provide this if the user explicitly requested to link a specific policy, otherwise leave undefined."),
        comment: z.string().optional().describe("Optional initial comment containing the complete details/message requested by the user (e.g. 'le urge el presupuesto')."),
      }),
    },
    async execute(args, ctx) {
      // deno-lint-ignore no-explicit-any
      const params = args as any;
      const result = await ctx.reminderWorkflow.create(ctx.agentId, {
        typeId: params.type_id || params.reminder_type_id,
        typeQuery: params.reminder_type_name_or_code,
        title: args.title as string,
        description: args.description as string ?? null,
        dueDate: args.due_date as string,
        contactId: args.contact_id as string ?? null,
        policyId: args.policy_id as string ?? null,
        comment: args.comment as string ?? null,
      });
      if (result.outcome === "type_unresolved") return TYPE_UNRESOLVED;
      const reminder = result.reminder;
      if (!reminder) return null;
      return reminderCreatedResult(reminder, ctx.timezone, reminder.contact?.fullName ?? null);
    },
  },
  {
    domain: "reminder",
    declaration: {
      name: "get_upcoming_reminders",
      description: "Retrieves the advisor's upcoming reminders within a date range. Only returns pending or in progress reminders. CRITICAL: If the user gives a relative time expression (e.g. 'today', 'this week', 'next 2 days', 'hoy', 'esta semana'), you MUST resolve it into local 'from'/'to' ISO 8601 bounds using the current date/time and timezone offset from the [CONTEXT] block. For 'today' (hoy) -> 'from' is today at 00:00:00 and 'to' is today at 23:59:59 using the local offset. If no time reference is given, leave both fields empty to query the default next 7 days. The response includes 'queriedRange' with the exact window consulted — before answering, verify each reminder's dueDate actually falls within the timeframe the user asked about. WHEN THE QUESTION IS ABOUT ONE PERSON ('que tengo pendiente de Julio', 'que le debo a Maria', 'de que quedamos con Rafael'), resolve them with search_contact first and pass their id as contact_id. WITHOUT contact_id this tool returns the advisor's ENTIRE agenda, and you would be reading them other clients' reminders as if they belonged to that person. With contact_id and no from/to, the answer is EVERY pending reminder for that contact with no date limit — that is what asking about a person means, so do NOT invent a window of your own.",
      schema: z.object({
        from: z.string().optional().describe("Local start range (ISO 8601, e.g. '2026-07-04T00:00:00-06:00'). MUST be calculated relative to [CONTEXT]'s local time when querying a relative timeframe."),
        to: z.string().optional().describe("Local end range (ISO 8601, e.g. '2026-07-04T23:59:59-06:00'). MUST be calculated relative to [CONTEXT]'s local time when querying a relative timeframe."),
        contact_id: z.string().optional().describe("UUID of a contact, taken from search_contact. Send it whenever the advisor's question is about one person, so the answer stays scoped to them instead of returning the whole agenda."),
      }),
    },
    async execute({ from, to, contact_id }, ctx) {
      // La ventana efectiva y los conteos fuera de ella los decide el service
      // (ver ReminderWorkflowService.getAgenda); aquí solo se convierten las
      // fechas al huso del asesor y se arma lo que lee el modelo.
      const agenda = await ctx.reminderWorkflow.getAgenda(ctx.agentId, {
        from: from as string | undefined,
        to: to as string | undefined,
        contactId: contact_id as string | undefined,
      });
      return agendaResult(agenda, ctx.timezone);
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
        status: z.string().optional().describe(`${STATUS_UPDATE_DESC} If setting to CANCELLED, a comment is MANDATORY: ask the advisor why they are cancelling it and pass that reason in comment.`),
        comment: z.string().optional().describe("Any follow-up details, notes, updates, or additions requested by the user. Pass the complete text of the new update/note here."),
      }),
    },
    async execute(args, ctx) {
      // deno-lint-ignore no-explicit-any
      const params = args as any;
      const result = await ctx.reminderWorkflow.update(params.reminder_id as string, {
        title: params.title as string | undefined,
        description: params.description as string | undefined,
        dueDate: params.due_date as string | undefined,
        typeId: params.type_id as string | undefined,
        status: params.status as string | undefined,
        comment: params.comment as string | undefined,
      });
      if (result.outcome === "comment_required") {
        return { error: "A comment is mandatory to cancel a reminder." };
      }
      if (result.outcome === "no_changes") throw nothingToUpdate();
      return result.reminder ? slimReminder(result.reminder, ctx.timezone) : null;
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
      const result = await ctx.reminderWorkflow.markDone(reminder_id as string, comment as string | undefined);
      return result ? slimReminder(result, ctx.timezone) : null;
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
      description: "Searches for reminders by text matching in title or description, optionally allowing filtering by status code, and optionally narrowed to a single client. When the advisor's question names a person, resolve them with search_contact and pass contact_id — otherwise the search spans their whole portfolio and returns other clients' reminders.",
      schema: z.object({
        query: z.string().describe("Text to search for in title or description"),
        status: z.string().optional().describe(STATUS_FILTER_DESC),
        contact_id: z.string().optional().describe("UUID of a contact, taken from search_contact. Send it when the question is about one person so the search stays scoped to them."),
      }),
    },
    async execute({ query, status, contact_id }, ctx) {
      const items = await ctx.reminderWorkflow.search(
        ctx.agentId,
        query as string,
        status as string | undefined,
        contact_id as string | undefined,
      );
      return items.map((r) => slimReminder(r, ctx.timezone));
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
        reminder_type_name_or_code: z.string().optional().describe("Code or name of the reminder type, matched against the real catalog. Call get_reminder_types first if you don't already know the codes from earlier in this conversation, then pick the code that best matches the user's message (e.g. 'dar seguimiento' -> a follow-up type). Only fall back to a generic/OTHER type after checking the catalog and finding no better match."),
        comment: z.string().optional().describe("Optional initial comment"),
      }),
    },
    async execute(args, ctx) {
      // deno-lint-ignore no-explicit-any
      const params = args as any;
      const result = await ctx.reminderWorkflow.createForClientName(ctx.agentId, params.client_name, {
        typeQuery: params.reminder_type_name_or_code,
        title: params.title as string,
        description: params.description || null,
        dueDate: params.due_date,
        comment: params.comment ?? null,
      });
      if (result.outcome === "type_unresolved") return TYPE_UNRESOLVED;
      if (result.outcome !== "created") return clientNotResolved(params.client_name, result);
      if (!result.reminder) return null;
      return reminderCreatedResult(result.reminder, ctx.timezone, result.contact.fullName);
    },
  },
  {
    domain: "reminder",
    declaration: {
      name: "search_reminder_notes",
      description: "Searches for notes or attached files/documents belonging to a specific reminder or to all reminders. Use when the user asks a question about notes, attachments, quotes, or details of a specific reminder or meeting.",
      schema: z.object({
        query: z.string({ required_error: "The question or topic to search for in reminder notes/attachments is required" })
          .describe("Question or topic to search for in reminder notes/attachments"),
        reminder_id: z.string().optional().describe("UUID of the reminder (optional, for filtering search within a specific reminder's attachments)"),
      }),
    },
    async execute({ query, reminder_id }, ctx) {
      return await ctx.ragService.searchNotes(ctx.agentId, query as string, {
        reminderId: reminder_id as string | undefined,
        threshold: entityThreshold(reminder_id as string | undefined),
      });
    },
  },
];
