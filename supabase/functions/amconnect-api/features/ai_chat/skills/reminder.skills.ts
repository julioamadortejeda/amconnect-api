import { z } from "zod";
import { assertHasChanges, SkillContext, SkillDefinition } from "./skill.core.ts";
import { ReminderResponseDTO } from "../../../modules/reminder/reminder.dto.ts";
import { utcToLocalIso } from "../../../shared/datetime.ts";
import { daysFromNowRange, isUuid } from "../../../shared/utils.ts";

// Postgres devuelve timestamptz en UTC; al modelo se le entregan ya convertidos
// al timezone del asesor para que no tenga que hacer aritmética de husos horarios.
const slimReminder = (r: ReminderResponseDTO, ctx: SkillContext) => ({
  id: r.id,
  title: r.title,
  description: r.description,
  dueDate: utcToLocalIso(r.dueDate, ctx.timezone),
  statusId: r.statusId,
  status: r.status,
  comments: r.comments?.map((c) => ({ ...c, createdAt: utcToLocalIso(c.createdAt, ctx.timezone) })),
  notes: r.notes?.map((n) => ({
    id: n.id,
    sourceType: n.source_type,
    summary: n.summary,
    content: n.content,
    fileName: n.document_metadata?.file_name,
    createdAt: utcToLocalIso(n.created_at, ctx.timezone),
  })),
  contactId: r.contactId,
  policyId: r.policyId,
  type: r.type,
  contact: r.contact,
  policy: r.policy,
});

const STATUS_UPDATE_DESC = "New status for the reminder — its code or its UUID, both are accepted. Call get_reminder_statuses first to get the catalog.";
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
      if (!result) return null;
      const slim = slimReminder(result, ctx);
      return {
        ...slim,
        __skillMetadata: {
          type: "reminder_created",
          reminderId: result.id,
          title: result.title,
          description: result.description,
          dueDate: slim.dueDate,
          clientName: result.contact?.fullName ?? null,
        },
      };
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
      const contactId = contact_id as string | undefined;

      // Rango efectivo explícito: si el modelo no manda bounds se aplica el
      // mismo default del service (próximos 7 días), pero informándolo en la
      // respuesta para que el modelo sepa qué ventana está viendo y no
      // presente tareas de mañana como pendientes de "hoy".
      //
      // Con `contact_id` la ventana por defecto NO aplica. Reportado por el
      // asesor de pruebas: preguntar por los pendientes de un cliente traía
      // los suyos y además la agenda próxima de todos los demás. Acotado a una
      // persona, "pendiente" no significa "esta semana" — significa todo lo que
      // le queda abierto, así esté a tres meses.
      const scoped = !!contactId;
      const usedDefault = !from && !to && !scoped;
      const defaults = daysFromNowRange(7);
      const fromEff = (from as string | undefined) ?? (scoped ? null : defaults.from);
      const toEff = (to as string | undefined) ?? (scoped ? null : defaults.to);

      const reminders = await ctx.reminderService.getUpcoming(ctx.agentId, fromEff, toEff, contactId);
      const slim = (reminders ?? []).map((r) => slimReminder(r, ctx));

      // Cuántos pendientes quedan DESPUÉS de la ventana consultada.
      //
      // Se cuenta SIEMPRE, no solo cuando `usedDefault`. Medido el 2026-09-03:
      // ante "¿qué tengo pendiente?" —sin ninguna referencia de tiempo— el
      // modelo NO dejó los campos vacíos como pide la descripción de la skill;
      // calculó él mismo una ventana de 7 días y la mandó en `from`/`to`. Con
      // eso `usedDefault` era false y el aviso no salía nunca, que es
      // exactamente el caso que venía a cubrir: un horizonte que el asesor
      // jamás pidió, ocultando un recordatorio a 12 días.
      //
      // El conteo es `head: true`, así que cuesta una consulta sin filas.
      // Sin tope superior no hay nada "más allá de la ventana" que contar, y la
      // consulta se ahorra.
      const afterCount = toEff
        ? await ctx.reminderService.countPendingAfter(ctx.agentId, toEff, contactId)
        : 0;

      // Y hacia atrás, que era el lado ciego. Medido el 2026-09-04: "qué tengo
      // pendiente de Zarah el próximo mes" contestó que en octubre no había
      // nada y se calló el del domingo siguiente, porque caía ANTES de la
      // ventana y nadie lo miraba. En la pregunta general el mismo hueco
      // esconde lo vencido — lo más urgente de la agenda.
      const beforeCount = fromEff
        ? await ctx.reminderService.countPendingBefore(ctx.agentId, fromEff, contactId)
        : 0;

      // Cuando la ventana arranca en el futuro ("el próximo mes"), lo que queda
      // antes mezcla lo vencido con lo que todavía está por venir. Se separan
      // para poder nombrar los overdueCount por su nombre en vez de decir "algunos".
      // Con la ventana por defecto, que arranca ahora, ya son lo mismo y la
      // segunda consulta no se hace.
      const now = new Date();
      const windowStartsInPast = !!fromEff && new Date(fromEff).getTime() <= now.getTime();
      const overdueCount = beforeCount === 0
        ? 0
        : windowStartsInPast
        ? beforeCount
        : await ctx.reminderService.countPendingBefore(ctx.agentId, now.toISOString(), contactId);

      return {
        queriedRange: {
          from: fromEff ? utcToLocalIso(fromEff, ctx.timezone) : null,
          to: toEff ? utcToLocalIso(toEff, ctx.timezone) : null,
          note: usedDefault
            ? "No explicit range was requested — this is the DEFAULT 7-day window. If the user asked about a narrower timeframe (e.g. today), filter by dueDate before answering."
            : (scoped && !from && !to
              ? "Scoped to ONE contact with no date limit: this is every pending reminder that contact has, near or far. Nothing was cut off by a window."
              : undefined),
        },
        // Para que el modelo no presente una lista de un solo cliente como si
        // fuera la agenda completa del asesor.
        ...(scoped ? { scope: "contact" as const } : {}),
        // Aparece siempre que de verdad quede algo fuera, sin importar quién
        // fijó la ventana: así el modelo no puede presentar una lista recortada
        // como si fuera toda la agenda.
        ...(afterCount > 0
          ? {
            beyondRange: {
              count: afterCount,
              instruction:
                `${afterCount} more pending reminder(s) fall AFTER the window above. ` +
                "If the advisor named this timeframe themselves ('este mes', 'hoy'), you may " +
                "leave them out silently — they asked for that period. But if they did NOT " +
                "name one ('que tengo pendiente', 'que traigo'), the window is YOURS, not " +
                "theirs: say which period you are showing, say there are more further out, " +
                "and offer to list them. Passing your own cut off as their whole agenda is a " +
                "false answer told with full confidence.",
            },
          }
          : {}),
        // El hermano de beyondRange. Un pendiente vencido no es algo que el
        // asesor haya elegido excluir al nombrar un periodo: preguntó por unas
        // fechas, no pidió esconder lo que ya se le pasó.
        ...(beforeCount > 0
          ? {
            beforeRange: {
              count: beforeCount,
              overdueCount: overdueCount,
              instruction: `${beforeCount} pending reminder(s) fall BEFORE the window above, so they are NOT in the list you just received. ` +
                (overdueCount > 0
                  ? `${overdueCount} of them are already OVERDUE — the due date passed and they are still open. ` +
                    "Overdue work is the most urgent thing on the agenda and this list cannot show it: say how many there are " +
                    "and offer to list them, even when the advisor named the timeframe themselves. "
                  : "They are simply earlier than the period asked about, so mention that they exist and offer to list them " +
                    "instead of letting your answer read as if nothing else were pending. ") +
                "To list them, call this tool again with a 'from' earlier than the current window.",
            },
          }
          : {}),
        reminders: slim,
        __skillMetadata: {
          type: "reminder_list",
          reminders: slim.map(r => ({
            id: r.id,
            title: r.title,
            description: r.description,
            dueDate: r.dueDate,
            clientName: r.contact?.fullName ?? null,
          })),
        },
      };
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
      // El modelo manda indistintamente el `code` o el `id` del estado, y no es
      // capricho: get_reminder_statuses devuelve los dos, y esta misma skill
      // pide el tipo como `type_id` en UUID. Se acepta cualquiera en vez de
      // pelearse con él desde la descripción — el service ya sabe resolver
      // ambos (`status` por code, `statusId` por id).
      const rawStatus = (params.status as string | undefined)?.trim() || undefined;
      const statusIsId = rawStatus !== undefined && isUuid(rawStatus);

      const changes = {
        title: params.title as string | undefined,
        description: params.description as string | undefined,
        dueDate: params.due_date as string | undefined,
        typeId: params.type_id as string | undefined,
        status: statusIsId ? undefined : rawStatus,
        statusId: statusIsId ? rawStatus : undefined,
        comment: params.comment as string | undefined,
      };
      assertHasChanges(changes);
      const result = await ctx.reminderService.update(params.reminder_id as string, changes);
      return result ? slimReminder(result, ctx) : null;
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
      return result ? slimReminder(result, ctx) : null;
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
      // Mismo motivo que en update_reminder: si llega el UUID del estado se
      // traduce a su code, que es lo que filtra el repositorio. Sin esto la
      // búsqueda no truena — devuelve vacío, que es peor.
      let statusCode = (status as string | undefined)?.trim() || undefined;
      if (statusCode && isUuid(statusCode)) {
        const all = await ctx.catalogServices.reminderStatusService.getAll();
        statusCode = all?.find((s) => s.id === statusCode)?.code as string | undefined;
      }
      const items = await ctx.reminderService.searchReminders(
        ctx.agentId,
        query as string,
        statusCode,
        contact_id as string | undefined,
      );
      return (items ?? []).map((r) => slimReminder(r, ctx));
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

      if (!reminder) return null;
      const slim = slimReminder(reminder, ctx);
      return {
        ...slim,
        __skillMetadata: {
          type: "reminder_created",
          reminderId: reminder.id,
          title: reminder.title,
          description: reminder.description,
          dueDate: slim.dueDate,
          clientName: contacts[0].fullName,
        },
      };
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
        threshold: 0.65,
      });
    },
  },
];
