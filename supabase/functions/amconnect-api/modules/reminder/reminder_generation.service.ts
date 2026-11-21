import { todayInTimezone } from "../../shared/datetime.ts";
import { daysUntil, nextOccurrence } from "../../shared/payment_schedule.ts";
import {
  estimatedDateNote,
  GENERATED_REMINDER_TYPE_CODES,
  YEARLY_INTERVAL_MONTHS,
} from "./reminder_generation.constants.ts";
import {
  renderReminderTitle,
  type ReminderTemplateData,
  type ReminderTitleParts,
  type ReminderTitleTemplate,
  TEMPLATE_BY_TYPE_CODE,
  toReminderLocale,
} from "./reminder_title.renderer.ts";
import type {
  CreateReminderData,
  GenerationCatalog,
  IReminderGenerationRepository,
  ReminderOwner,
} from "./reminder_generation.repository.ts";
import type { ReminderSettingResolver, ReminderSettingService } from "./reminder_setting.service.ts";

export interface GeneratedReminder {
  id: string;
  typeCode: string;
  typeName: string;
  title: string;
  dueDate: string;
  isNew: boolean;
}

export interface ReminderGenerationResult {
  created: GeneratedReminder[];
  existing: GeneratedReminder[];
  /**
   * Presente solo si la generación falló. Los métodos públicos no lanzan: el
   * skill de pólizas los llama DESPUÉS de guardar la póliza, y una excepción ahí
   * haría parecer que la póliza falló — el modelo la reintentaría y la
   * duplicaría. El job nocturno lee este campo para contar la falla.
   */
  error?: string;
}

const EMPTY_RESULT: ReminderGenerationResult = { created: [], existing: [] };

export interface PolicyRow {
  id: string;
  policyNumber?: string | null;
  nextPaymentDate?: string | null;
  renewalDate?: string | null;
  endDate?: string | null;
  startDate?: string | null;
  /** undefined = unknown, look it up; null = the policy has no branch. */
  branchId?: string | null;
  paymentFrequencyMonths?: number | null;
  /**
   * Holder and labels for the title. The cron supplies them inline; when
   * `clientName` is undefined they are looked up with the schedule info.
   */
  contactId?: string | null;
  clientName?: string | null;
  productName?: string | null;
  branchName?: string | null;
  branchCode?: string | null;
  premium?: number | string | null;
  currencyCode?: string | null;
}

export interface ContactRow {
  id: string;
  fullName?: string | null;
  birthdate?: string | null;
}

interface Candidate {
  typeCode: string;
  title: string;
  titleTemplate: ReminderTitleTemplate;
  templateData: ReminderTemplateData;
  /** The date the series lands on, YYYY-MM-DD. */
  occurrence: string;
  branchId: string | null;
  /** Solo cuando la fecha se dedujo: le dice al asesor que no la leyó nadie. */
  description?: string;
}

// Returns "YYYY-MM-DDT00:00:00±HH:MM" — local midnight in the advisor's timezone.
// Storing local midnight in a timestamptz column means Flutter's .toLocal() gives
// back the same date with hour=0, which shows the right day and no time.
function toLocalMidnight(dateStr: string, timezoneOffset: string): string {
  return `${dateStr.substring(0, 10)}T00:00:00${timezoneOffset}`;
}

/**
 * Lo que se guarda en `title`: la misma plantilla ya armada en el idioma del
 * asesor. Solo la leen clientes viejos y el respaldo cuando la plantilla falta;
 * lo que se muestra se vuelve a armar al leer (D-023).
 */
function fallbackTitle(template: ReminderTitleTemplate, parts: ReminderTitleParts, locale: string): string {
  return renderReminderTitle(template, parts, locale) ?? template;
}

function toAmount(value: number | string | null | undefined): number | undefined {
  if (value === null || value === undefined || value === "") return undefined;
  const n = Number(value);
  return Number.isFinite(n) ? n : undefined;
}

/**
 * Creates policy and contact reminders just in time.
 *
 * Nothing is materialised ahead of time: every run recomputes the next occurrence
 * from the policy's own rule (anchor date + payment frequency) and only writes a
 * reminder once that date enters the advisor's warning window. A rescheduled
 * reminder is therefore a one-off — the following occurrence is still derived
 * from the policy, so moving one payment never drags the rest of the series.
 */
export class ReminderGenerationService {
  constructor(
    private readonly repository: IReminderGenerationRepository,
    private readonly settingService: ReminderSettingService,
    /**
     * Idioma del asesor para el título de respaldo y la nota de fecha
     * estimada cuando quien llama no lo pasa (la confirmación de pólizas).
     */
    private readonly defaultLocale: string = "es",
  ) {}

  /** Catálogos (estado CREATED y tipos), cargados una vez por instancia. */
  private catalog: Promise<GenerationCatalog> | null = null;

  private loadCatalog(): Promise<GenerationCatalog> {
    if (!this.catalog) {
      this.catalog = this.repository.findCatalog(GENERATED_REMINDER_TYPE_CODES);
      // Si falla no se queda cacheado el error: la siguiente llamada reintenta.
      this.catalog.catch(() => { this.catalog = null; });
    }
    return this.catalog;
  }

  async generateForPolicy(
    policy: PolicyRow,
    agentId: string,
    timezoneOffset = "-06:00",
    resolver?: ReminderSettingResolver,
    locale?: string,
  ): Promise<ReminderGenerationResult> {
    try {
      return await this.generateForPolicyOrThrow(policy, agentId, timezoneOffset, resolver, toReminderLocale(locale ?? this.defaultLocale));
    } catch (err) {
      return this.failed(`policy ${policy.id}`, err);
    }
  }

  /** Birthdays hang from the contact, so one client with three policies gets one reminder. */
  async generateForContact(
    contact: ContactRow,
    agentId: string,
    timezoneOffset = "-06:00",
    resolver?: ReminderSettingResolver,
    locale?: string,
  ): Promise<ReminderGenerationResult> {
    try {
      return await this.generateForContactOrThrow(contact, agentId, timezoneOffset, resolver, toReminderLocale(locale ?? this.defaultLocale));
    } catch (err) {
      return this.failed(`contact ${contact.id}`, err);
    }
  }

  private failed(what: string, err: unknown): ReminderGenerationResult {
    const message = err instanceof Error
      ? ((err as { internal?: string }).internal ?? err.message)
      : String(err);
    console.error(`[ReminderGenerationService] ${what}:`, message);
    return { ...EMPTY_RESULT, error: message };
  }

  private async generateForPolicyOrThrow(
    policy: PolicyRow,
    agentId: string,
    timezoneOffset: string,
    resolver: ReminderSettingResolver | undefined,
    locale: string,
  ): Promise<ReminderGenerationResult> {
    const settings = resolver ?? await this.settingService.buildResolver();
    const today = todayInTimezone(timezoneOffset);

    // The cron supplies these inline; other callers leave them unknown.
    let branchId = policy.branchId;
    let frequencyMonths = policy.paymentFrequencyMonths;
    let details = policy;
    if (branchId === undefined || frequencyMonths === undefined || policy.clientName === undefined) {
      const info = await this.repository.findPolicyScheduleInfo(policy.id);
      branchId = branchId === undefined ? info?.branchId ?? null : branchId;
      frequencyMonths = frequencyMonths === undefined ? info?.frequencyMonths ?? null : frequencyMonths;
      details = {
        ...policy,
        contactId: policy.contactId ?? info?.contactId ?? null,
        clientName: info?.clientName ?? null,
        productName: info?.productName ?? null,
        branchName: info?.branchName ?? null,
        branchCode: info?.branchCode ?? null,
        premium: policy.premium ?? info?.premium ?? null,
        currencyCode: policy.currencyCode ?? info?.currencyCode ?? null,
      };
    }
    const parts: ReminderTitleParts = {
      productName: details.productName,
      branchName: details.branchName,
      branchCode: details.branchCode,
      clientName: details.clientName,
      policyNumber: policy.policyNumber,
    };
    const amount = toAmount(details.premium);

    const series: Array<{ typeCode: string; anchor?: string | null; intervalMonths: number; estimated?: boolean }> = [
      {
        typeCode: "PAYMENT",
        // Sin `next_payment_date` el aviso de cobro no llegaba NUNCA — no es que
        // tardara: la serie se saltaba por falta de ancla. Y muchas carátulas no
        // imprimen esa fecha, solo el inicio y la frecuencia (2 de 3 pólizas de
        // prueba). Se deduce del inicio, que es donde cae el aniversario de pago.
        //
        // SOLO si la frecuencia se conoce y es recurrente. Sin ese candado, una
        // póliza de pago único heredaría el default anual de abajo y le
        // inventaría al asesor un cobro que no existe — y un recordatorio falso
        // es peor que uno faltante: lo manda a cobrarle a alguien que ya pagó.
        // (`payment_frequencies` no tiene fila SINGLE, así que el pago único
        // llega aquí con `frequencyMonths` nulo y queda fuera solo.)
        anchor: policy.nextPaymentDate ??
          (frequencyMonths && frequencyMonths > 0 ? policy.startDate : null),
        intervalMonths: frequencyMonths && frequencyMonths > 0 ? frequencyMonths : YEARLY_INTERVAL_MONTHS,
        // El asesor tiene que poder distinguir la fecha que alguien leyó de la
        // que dedujo el sistema, antes de llamarle a un cliente.
        estimated: !policy.nextPaymentDate,
      },
      {
        typeCode: "RENEWAL",
        anchor: policy.renewalDate ?? policy.endDate,
        intervalMonths: YEARLY_INTERVAL_MONTHS,
      },
      {
        typeCode: "ANNIVERSARY",
        anchor: policy.startDate,
        intervalMonths: YEARLY_INTERVAL_MONTHS,
      },
    ];

    const candidates: Candidate[] = [];
    for (const entry of series) {
      if (!entry.anchor) continue;

      const setting = settings.resolve(entry.typeCode, branchId ?? null);
      if (!setting.isActive) continue;

      const occurrence = nextOccurrence(entry.anchor, entry.intervalMonths, today);
      if (!occurrence) continue;

      const remaining = daysUntil(occurrence, today);
      if (remaining === null || remaining > setting.daysBefore) continue;

      const template = TEMPLATE_BY_TYPE_CODE[entry.typeCode];
      const templateData: ReminderTemplateData = { dueDate: occurrence };
      // El monto solo dice algo en el aviso de cobro.
      if (entry.typeCode === "PAYMENT" && amount !== undefined) {
        templateData.amount = amount;
        if (details.currencyCode) templateData.currency = details.currencyCode;
      }
      candidates.push({
        typeCode: entry.typeCode,
        title: fallbackTitle(template, parts, locale),
        titleTemplate: template,
        templateData,
        occurrence,
        branchId: branchId ?? null,
        ...(entry.estimated ? { description: estimatedDateNote(locale) } : {}),
      });
    }

    return this.persist(candidates, agentId, { policyId: policy.id, contactId: details.contactId ?? null }, timezoneOffset);
  }

  private async generateForContactOrThrow(
    contact: ContactRow,
    agentId: string,
    timezoneOffset: string,
    resolver: ReminderSettingResolver | undefined,
    locale: string,
  ): Promise<ReminderGenerationResult> {
    if (!contact.birthdate) return { created: [], existing: [] };

    const settings = resolver ?? await this.settingService.buildResolver();
    const setting = settings.resolve("BIRTHDAY", null);
    if (!setting.isActive) return { created: [], existing: [] };

    const today = todayInTimezone(timezoneOffset);
    const occurrence = nextOccurrence(contact.birthdate, YEARLY_INTERVAL_MONTHS, today);
    if (!occurrence) return { created: [], existing: [] };

    const remaining = daysUntil(occurrence, today);
    if (remaining === null || remaining > setting.daysBefore) return { created: [], existing: [] };

    const candidate: Candidate = {
      typeCode: "BIRTHDAY",
      title: fallbackTitle("BIRTHDAY", { clientName: contact.fullName }, locale),
      titleTemplate: "BIRTHDAY",
      templateData: { dueDate: occurrence },
      occurrence,
      branchId: null,
    };

    return this.persist([candidate], agentId, { contactId: contact.id }, timezoneOffset);
  }

  private async persist(
    candidates: Candidate[],
    agentId: string,
    owner: ReminderOwner,
    timezoneOffset: string,
  ): Promise<ReminderGenerationResult> {
    if (candidates.length === 0) return { created: [], existing: [] };

    const catalog = await this.loadCatalog();
    const typeByCode = new Map(catalog.types.map((t) => [t.code, t]));
    const typeById = new Map(catalog.types.map((t) => [t.id, t]));

    const rows: CreateReminderData[] = [];
    for (const candidate of candidates) {
      const type = typeByCode.get(candidate.typeCode);
      if (!type) continue;
      rows.push({
        agentId,
        owner,
        typeId: type.id,
        title: candidate.title,
        titleTemplate: candidate.titleTemplate,
        templateData: candidate.templateData,
        description: candidate.description,
        dueDate: toLocalMidnight(candidate.occurrence, timezoneOffset),
        occurrenceDate: candidate.occurrence,
      });
    }

    // Un solo candado, y exacto: el índice único de ocurrencia. Se pregunta por
    // la ocurrencia y no por la fecha del aviso, así que reagendarlo —cerca o
    // lejos— no lo saca de su ciclo ni resucita el ciclo que ya cubría. Y cuenta
    // cualquier estado: abierto, HECHO, CANCELADO o borrado por el asesor. En
    // todos ellos insistir sería pelearse con él.
    const inserted = await this.repository.insertGenerated(rows, catalog.createdStatusId);

    const created: GeneratedReminder[] = [];
    const existing: GeneratedReminder[] = [];
    for (const row of inserted) {
      const type = typeById.get(row.typeId);
      if (!type) continue;
      const generated: GeneratedReminder = {
        id: row.id,
        typeCode: type.code,
        typeName: type.name,
        title: row.title,
        dueDate: row.dueDate,
        isNew: row.isNew,
      };
      if (row.isNew) created.push(generated);
      // Uno que el asesor borró no se le presenta como "ya existente".
      else if (row.isActive) existing.push(generated);
    }

    return { created, existing };
  }
}
