import type { ReminderResponseDTO } from "./reminder.dto.ts";
import type { ReminderService } from "./reminder.service.ts";
import type { CatalogServices } from "../catalog/catalog.service.ts";
import type { ContactResponseDTO } from "../contact/contact.dto.ts";
import type { ContactWorkflowService } from "../contact/contact_workflow.service.ts";
import { daysFromNowRange, hasAnyChange, isUuid } from "../../shared/utils.ts";
import { calcTimezoneOffset, utcToLocalIso } from "../../shared/datetime.ts";
import { AppError } from "../../shared/errors.ts";

type ReminderDeps = Pick<
  ReminderService,
  "create" | "update" | "getById" | "getUpcoming" | "countPendingAfter" | "countPendingBefore" | "searchReminders"
>;
type CatalogDeps = Pick<CatalogServices, "reminderTypeService" | "reminderStatusService">;
type ContactResolver = Pick<ContactWorkflowService, "resolveByName">;

export interface CreateReminderInput {
  /** UUID del tipo, si ya se conoce. Gana sobre `typeQuery`. */
  typeId?: string;
  /** Code o nombre del tipo; se resuelve contra el catálogo real. */
  typeQuery?: string;
  title: string;
  description: string | null;
  dueDate: string;
  contactId: string | null;
  policyId: string | null;
  comment: string | null;
}

export interface CreateReminderForClientInput {
  typeQuery?: string;
  title: string;
  description: string | null;
  dueDate: string;
  comment: string | null;
}

export interface UpdateReminderInput {
  title?: string;
  description?: string;
  dueDate?: string;
  typeId?: string;
  /** El estado tal como llegó: su code o su UUID, se aceptan los dos. */
  status?: string;
  comment?: string;
}

export interface RescheduleReminderInput {
  /** Día nuevo, YYYY-MM-DD, en el huso del asesor. Sin él se conserva el día local original. */
  newDate?: string;
  /** Hora nueva HH:MM (local). Sin ella se conserva la hora local original. */
  newTime?: string;
  /** Huso del asesor (IANA). */
  timezone: string;
}

export type RescheduleReminderResult =
  | { outcome: "not_found" }
  | { outcome: "rescheduled"; reminder: ReminderResponseDTO | null };

export type CreateReminderResult =
  | { outcome: "type_unresolved" }
  | { outcome: "created"; reminder: ReminderResponseDTO | null };

export type CreateReminderForClientResult =
  | { outcome: "type_unresolved" }
  | { outcome: "none" }
  | { outcome: "ambiguous"; matches: ContactResponseDTO[] }
  | { outcome: "created"; reminder: ReminderResponseDTO | null; contact: ContactResponseDTO };

export type UpdateReminderResult =
  | { outcome: "comment_required" }
  | { outcome: "no_changes" }
  | { outcome: "updated"; reminder: ReminderResponseDTO | null };

/**
 * La agenda de pendientes con todo lo que hace falta para no presentar una
 * lista recortada como si fuera completa. Fechas en UTC, tal como las guarda
 * Postgres: convertirlas al huso del asesor es tarea de quien las muestra.
 */
export interface ReminderAgenda {
  reminders: ReminderResponseDTO[];
  /** Ventana efectiva. `null` = sin límite por ese lado. */
  range: { from: string | null; to: string | null };
  /** Nadie pidió ventana y se aplicó la default de 7 días. */
  usedDefault: boolean;
  /** Acotada a un contacto: sin ventana por defecto. */
  scoped: boolean;
  /** Pendientes después de `range.to`. */
  afterCount: number;
  /** Pendientes antes de `range.from`. */
  beforeCount: number;
  /** De esos, los que ya vencieron. */
  overdueCount: number;
}

/** Ventana por defecto de la agenda (RULES §5.1). */
const DEFAULT_AGENDA_DAYS = 7;

/**
 * Reglas de negocio de recordatorios que necesitan más que el repositorio:
 * resolver tipo y estado por nombre o code, el cliente por nombre, y la agenda
 * con sus conteos fuera de ventana.
 */
export class ReminderWorkflowService {
  constructor(
    private reminderService: ReminderDeps,
    private contacts: ContactResolver,
    private catalogServices: CatalogDeps,
  ) {}

  /**
   * Code o nombre → id del tipo. Sin match cae a OTHER (o al primero del
   * catálogo). `null` = el catálogo no se pudo leer; `undefined` = catálogo
   * vacío.
   */
  async resolveTypeId(typeQuery: string | undefined): Promise<string | undefined | null> {
    const types = await this.catalogServices.reminderTypeService.getAll();
    if (!types) return null;
    const query = (typeQuery || "OTHER").toUpperCase().trim();
    const byCode = types.find((t) => String(t.code).toUpperCase() === query);
    if (byCode) return byCode.id as string;
    const byName = types.find((t) => String(t.name).toUpperCase().includes(query));
    return byName
      ? (byName.id as string)
      : (types.find((t) => t.code === "OTHER")?.id as string ?? types[0]?.id as string);
  }

  async create(agentId: string, input: CreateReminderInput): Promise<CreateReminderResult> {
    const typeId = input.typeId || (await this.resolveTypeId(input.typeQuery)) || undefined;
    if (!typeId) return { outcome: "type_unresolved" };

    const reminder = await this.reminderService.create({
      agentId,
      typeId,
      title: input.title,
      description: input.description,
      dueDate: input.dueDate,
      contactId: input.contactId,
      policyId: input.policyId,
      comment: input.comment,
    });
    return { outcome: "created", reminder };
  }

  /** Resuelve al cliente por nombre y solo si es uno crea el recordatorio ligado a él. */
  async createForClientName(
    agentId: string,
    clientName: string,
    input: CreateReminderForClientInput,
  ): Promise<CreateReminderForClientResult> {
    const resolution = await this.contacts.resolveByName(agentId, clientName);
    if (resolution.outcome !== "unique") return resolution;

    // Antes, con el catálogo ilegible se intentaba crear con `typeId: ""` y
    // el insert tronaba con un error de Postgres. Mismo resultado que `create`.
    const typeId = await this.resolveTypeId(input.typeQuery);
    if (!typeId) return { outcome: "type_unresolved" };
    const reminder = await this.reminderService.create({
      agentId,
      typeId,
      title: input.title,
      description: input.description,
      dueDate: input.dueDate,
      contactId: resolution.contact.id,
      comment: input.comment,
    });
    return { outcome: "created", reminder, contact: resolution.contact };
  }

  /**
   * Cambios desde el asistente. Cancelar exige un comentario con el motivo;
   * el estado puede llegar como code o como UUID — `get_reminder_statuses`
   * devuelve los dos y el modelo usa cualquiera.
   */
  async update(id: string, input: UpdateReminderInput): Promise<UpdateReminderResult> {
    const rawStatus = input.status?.trim() || undefined;
    const statusIsId = rawStatus !== undefined && isUuid(rawStatus);
    // Antes solo se reconocía "CANCELLED" literal: "cancelled" o el UUID del
    // estado se saltaban esta validación y el service tronaba con un 400
    // genérico en vez del motivo claro.
    if (await this.isCancelStatus(rawStatus, statusIsId) && (!input.comment || !input.comment.trim())) {
      return { outcome: "comment_required" };
    }

    const changes = {
      title: input.title,
      description: input.description,
      dueDate: input.dueDate,
      typeId: input.typeId,
      status: statusIsId ? undefined : rawStatus,
      statusId: statusIsId ? rawStatus : undefined,
      comment: input.comment,
    };
    // Un `comment` solo cuenta como cambio: no toca la fila pero sí inserta
    // un comentario.
    if (!hasAnyChange(changes)) return { outcome: "no_changes" };
    const reminder = await this.reminderService.update(id, changes);
    return { outcome: "updated", reminder };
  }

  /**
   * Mueve un recordatorio que YA existe a otro día (y hora). Nunca crea: si no
   * hay tal recordatorio visible para el asesor (RLS) devuelve `not_found`.
   * Sin `newDate` conserva el día local original (solo cambia la hora). Sin
   * `newTime` conserva la hora local original; un recordatorio de solo
   * fecha (medianoche local) sigue siendo de solo fecha.
   */
  async reschedule(id: string, input: RescheduleReminderInput): Promise<RescheduleReminderResult> {
    let existing: ReminderResponseDTO | null;
    try {
      existing = await this.reminderService.getById(id);
    } catch (e) {
      if (e instanceof AppError && e.statusCode === 404) return { outcome: "not_found" };
      throw e;
    }
    if (!existing) return { outcome: "not_found" };

    const originalLocal = utcToLocalIso(existing.dueDate, input.timezone) ?? existing.dueDate;
    const originalTime = originalLocal.match(/T(\d{2}:\d{2}:\d{2})/)?.[1] ?? "00:00:00";
    const originalDate = originalLocal.slice(0, 10);
    const date = input.newDate ?? originalDate;
    const time = input.newTime ? `${input.newTime}:00` : originalTime;
    // El offset se calcula en el día NUEVO: puede cambiar por horario de verano.
    const offset = calcTimezoneOffset(input.timezone, new Date(`${date}T${time}Z`));
    const dueDate = `${date}T${time}${offset}`;
    const reminder = await this.reminderService.update(id, { dueDate });
    return { outcome: "rescheduled", reminder };
  }

  private async isCancelStatus(rawStatus: string | undefined, statusIsId: boolean): Promise<boolean> {
    if (!rawStatus) return false;
    if (!statusIsId) return rawStatus.toUpperCase() === "CANCELLED";
    const all = await this.catalogServices.reminderStatusService.getAll();
    const status = all?.find((s) => s.id === rawStatus);
    return String(status?.code ?? "").toUpperCase() === "CANCELLED";
  }

  markDone(id: string, comment?: string): Promise<ReminderResponseDTO | null> {
    return this.reminderService.update(id, { status: "DONE", comment });
  }

  /**
   * Búsqueda por texto. Si el estado llega como UUID se traduce a su code, que
   * es lo que filtra el repositorio — sin esto la búsqueda no truena, devuelve
   * vacío, que es peor.
   */
  async search(
    agentId: string,
    query: string,
    status?: string,
    contactId?: string,
  ): Promise<ReminderResponseDTO[]> {
    let statusCode = status?.trim() || undefined;
    if (statusCode && isUuid(statusCode)) {
      const all = await this.catalogServices.reminderStatusService.getAll();
      statusCode = all?.find((s) => s.id === statusCode)?.code as string | undefined;
    }
    return await this.reminderService.searchReminders(agentId, query, statusCode, contactId) ?? [];
  }

  /**
   * Los pendientes de una ventana y lo que queda fuera de ella.
   *
   * - Sin `from`/`to` y sin contacto: los próximos 7 días (`usedDefault`).
   * - Con contacto y sin fechas: SIN ventana. Acotado a una persona,
   *   "pendiente" significa todo lo que le queda abierto, así esté a tres meses.
   * - `afterCount` se cuenta SIEMPRE que haya tope superior, no solo con la
   *   ventana default: el modelo suele calcular él mismo los 7 días y mandarlos
   *   en `from`/`to` (medido 2026-09-03), y el aviso no salía nunca.
   * - `beforeCount` es el lado ciego: lo vencido, lo más urgente (2026-09-04).
   *   Cuando la ventana arranca en el futuro, lo de antes mezcla lo vencido con
   *   lo que aún viene, y `overdueCount` los separa con una segunda consulta.
   */
  async getAgenda(
    agentId: string,
    opts: { from?: string; to?: string; contactId?: string },
  ): Promise<ReminderAgenda> {
    const { from, to, contactId } = opts;
    const scoped = !!contactId;
    const usedDefault = !from && !to && !scoped;
    const defaults = daysFromNowRange(DEFAULT_AGENDA_DAYS);
    const fromEff = from ?? (scoped ? null : defaults.from);
    const toEff = to ?? (scoped ? null : defaults.to);

    const reminders = await this.reminderService.getUpcoming(agentId, fromEff, toEff, contactId);

    // `head: true` en el repositorio: cuesta una consulta sin filas.
    const afterCount = toEff ? await this.reminderService.countPendingAfter(agentId, toEff, contactId) : 0;
    const beforeCount = fromEff ? await this.reminderService.countPendingBefore(agentId, fromEff, contactId) : 0;

    const now = new Date();
    const windowStartsInPast = !!fromEff && new Date(fromEff).getTime() <= now.getTime();
    const overdueCount = beforeCount === 0
      ? 0
      : windowStartsInPast
      ? beforeCount
      : await this.reminderService.countPendingBefore(agentId, now.toISOString(), contactId);

    return {
      reminders: reminders ?? [],
      range: { from: fromEff, to: toEff },
      usedDefault,
      scoped,
      afterCount,
      beforeCount,
      overdueCount,
    };
  }
}
