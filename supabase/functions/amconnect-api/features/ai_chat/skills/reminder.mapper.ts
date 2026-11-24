// Lo que el MODELO (y la tarjeta del chat) ven de un recordatorio. Solo forma:
// las reglas de negocio viven en ReminderWorkflowService.
import type { ReminderResponseDTO } from "../../../modules/reminder/reminder.dto.ts";
import type { ReminderAgenda } from "../../../modules/reminder/reminder_workflow.service.ts";
import { utcToLocalIso } from "../../../shared/datetime.ts";

// Postgres devuelve timestamptz en UTC; al modelo se le entregan ya convertidos
// al timezone del asesor para que no tenga que hacer aritmética de husos horarios.
export const slimReminder = (r: ReminderResponseDTO, timezone: string) => ({
  id: r.id,
  title: r.title,
  description: r.description,
  dueDate: utcToLocalIso(r.dueDate, timezone),
  statusId: r.statusId,
  status: r.status,
  comments: r.comments?.map((c) => ({ ...c, createdAt: utcToLocalIso(c.createdAt, timezone) })),
  notes: r.notes?.map((n) => ({
    id: n.id,
    sourceType: n.sourceType,
    summary: n.summary,
    content: n.content,
    fileName: n.documentMetadata?.fileName,
    createdAt: utcToLocalIso(n.createdAt, timezone),
  })),
  contactId: r.contactId,
  policyId: r.policyId,
  type: r.type,
  contact: r.contact,
  policy: r.policy,
});

/** Recordatorio recién creado + la tarjeta `reminder_created`. */
export function reminderCreatedResult(reminder: ReminderResponseDTO, timezone: string, clientName: string | null) {
  const slim = slimReminder(reminder, timezone);
  return {
    ...slim,
    __skillMetadata: {
      type: "reminder_created",
      reminderId: reminder.id,
      title: reminder.title,
      description: reminder.description,
      dueDate: slim.dueDate,
      clientName,
    },
  };
}

type SlimReminder = ReturnType<typeof slimReminder>;

/** La tarjeta `reminder_list`. Lista vacía = sin tarjeta (si no, la app pinta solo "Ir a la agenda"). */
function reminderListMetadata(slim: SlimReminder[]) {
  if (slim.length === 0) return {};
  return {
    __skillMetadata: {
      type: "reminder_list",
      reminders: slim.map((r) => ({
        id: r.id,
        title: r.title,
        description: r.description,
        dueDate: r.dueDate,
        clientName: r.contact?.fullName ?? null,
      })),
    },
  };
}

/** La agenda tal como la lee el modelo: hechos, nunca prosa (RULES §5). */
export function agendaResult(agenda: ReminderAgenda, timezone: string) {
  const slim = agenda.reminders.map((r) => slimReminder(r, timezone));
  return {
    // Solo la ventana y quien la fijo. Que hacer cuando es la default
    // —filtrar por dueDate si el asesor pidio algo mas angosto— es politica
    // constante y vive en READING TOOL RESULTS del prompt.
    queriedRange: {
      from: agenda.range.from ? utcToLocalIso(agenda.range.from, timezone) : null,
      to: agenda.range.to ? utcToLocalIso(agenda.range.to, timezone) : null,
      ...(agenda.usedDefault ? { isDefault: true } : {}),
    },
    // Para que el modelo no presente una lista de un solo cliente como si
    // fuera la agenda completa del asesor.
    ...(agenda.scoped ? { scope: "contact" as const } : {}),
    // Aparece siempre que de verdad quede algo fuera, sin importar quién
    // fijó la ventana: así el modelo no puede presentar una lista recortada
    // como si fuera toda la agenda.
    ...(agenda.afterCount > 0 ? { beyondRange: { count: agenda.afterCount } } : {}),
    // El hermano de beyondRange. Un pendiente vencido no es algo que el
    // asesor haya elegido excluir al nombrar un periodo: preguntó por unas
    // fechas, no pidió esconder lo que ya se le pasó.
    ...(agenda.beforeCount > 0
      ? { beforeRange: { count: agenda.beforeCount, overdue: agenda.overdueCount } }
      : {}),
    reminders: slim,
    ...reminderListMetadata(slim),
  };
}

/**
 * Un recordatorio que acaba de cambiar (reagendar, editar, marcar hecho). El
 * último `__skillMetadata` del turno es el que pinta la tarjeta: si el modelo
 * listó la agenda y luego movió un recordatorio, la tarjeta de la lista
 * seguía mostrando la hora vieja. Se emite la misma `reminder_list`, con el
 * recordatorio ya actualizado, para que la tarjeta final diga lo que quedó.
 */
export function reminderChangedResult(reminder: ReminderResponseDTO, timezone: string) {
  const slim = slimReminder(reminder, timezone);
  return { ...slim, ...reminderListMetadata([slim]) };
}
