import { todayInTimezone } from "../../shared/datetime.ts";
import { daysUntil, nextOccurrence } from "../../shared/payment_schedule.ts";
import {
  REMINDER_TITLES,
  YEARLY_INTERVAL_MONTHS,
} from "./reminder_generation.constants.ts";
import type {
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
}

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
}

export interface ContactRow {
  id: string;
  fullName?: string | null;
  birthdate?: string | null;
}

interface Candidate {
  typeCode: string;
  title: string;
  /** The date the series lands on, YYYY-MM-DD. */
  occurrence: string;
  branchId: string | null;
}

// Returns "YYYY-MM-DDT00:00:00±HH:MM" — local midnight in the advisor's timezone.
// Storing local midnight in a timestamptz column means Flutter's .toLocal() gives
// back the same date with hour=0, which shows the right day and no time.
function toLocalMidnight(dateStr: string, timezoneOffset: string): string {
  return `${dateStr.substring(0, 10)}T00:00:00${timezoneOffset}`;
}

function titleFor(typeCode: string, label: string): string {
  return REMINDER_TITLES[typeCode]?.(label) ?? label;
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
  ) {}

  async generateForPolicy(
    policy: PolicyRow,
    agentId: string,
    timezoneOffset = "-06:00",
    resolver?: ReminderSettingResolver,
  ): Promise<ReminderGenerationResult> {
    const settings = resolver ?? await this.settingService.buildResolver();
    const today = todayInTimezone(timezoneOffset);
    const label = policy.policyNumber ?? "póliza";

    // The cron supplies these inline; other callers leave them unknown.
    let branchId = policy.branchId;
    let frequencyMonths = policy.paymentFrequencyMonths;
    if (branchId === undefined || frequencyMonths === undefined) {
      const info = await this.repository.findPolicyScheduleInfo(policy.id);
      branchId = branchId === undefined ? info?.branchId ?? null : branchId;
      frequencyMonths = frequencyMonths === undefined ? info?.frequencyMonths ?? null : frequencyMonths;
    }

    const series: Array<{ typeCode: string; anchor?: string | null; intervalMonths: number }> = [
      {
        typeCode: "PAYMENT",
        anchor: policy.nextPaymentDate,
        intervalMonths: frequencyMonths && frequencyMonths > 0 ? frequencyMonths : YEARLY_INTERVAL_MONTHS,
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

      candidates.push({
        typeCode: entry.typeCode,
        title: titleFor(entry.typeCode, label),
        occurrence,
        branchId: branchId ?? null,
      });
    }

    return this.persist(candidates, agentId, { policyId: policy.id }, timezoneOffset);
  }

  /** Birthdays hang from the contact, so one client with three policies gets one reminder. */
  async generateForContact(
    contact: ContactRow,
    agentId: string,
    timezoneOffset = "-06:00",
    resolver?: ReminderSettingResolver,
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
      title: titleFor("BIRTHDAY", contact.fullName ?? "cliente"),
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

    const statusIds = await this.repository.findStatusIdsByCodes(["CREATED"]);
    const createdStatusId = statusIds["CREATED"];
    if (!createdStatusId) {
      console.error("[ReminderGenerationService] CREATED status not found in reminder_statuses");
      return { created: [], existing: [] };
    }

    const types = await this.repository.findReminderTypesByCodes(candidates.map((c) => c.typeCode));
    const typeMap = new Map(types.map((t) => [t.code, t]));

    const created: GeneratedReminder[] = [];
    const existing: GeneratedReminder[] = [];

    for (const candidate of candidates) {
      const type = typeMap.get(candidate.typeCode);
      if (!type) continue;

      const dueDate = toLocalMidnight(candidate.occurrence, timezoneOffset);

      // Un solo candado, y exacto: ¿ya existe el recordatorio de ESTA ocurrencia?
      // Se pregunta por la ocurrencia y no por la fecha del aviso, así que
      // reagendarlo —cerca o lejos— no lo saca de su ciclo ni resucita el ciclo
      // que ya cubría. Los ciclos siguientes se generan normal.
      const existingRow = await this.repository.findReminderForOccurrence(
        agentId, owner, type.id, candidate.occurrence,
      );
      if (existingRow) {
        existing.push({
          id: existingRow.id,
          typeCode: candidate.typeCode,
          typeName: type.name,
          title: existingRow.title,
          dueDate: existingRow.dueDate,
          isNew: false,
        });
        continue;
      }

      const id = await this.repository.createReminder({
        agentId,
        owner,
        typeId: type.id,
        title: candidate.title,
        dueDate,
        occurrenceDate: candidate.occurrence,
      }, createdStatusId);

      if (id) {
        created.push({
          id,
          typeCode: candidate.typeCode,
          typeName: type.name,
          title: candidate.title,
          dueDate,
          isNew: true,
        });
      }
    }

    return { created, existing };
  }
}
