import type { IReminderGenerationRepository } from "./reminder_generation.repository.ts";
import { REMINDER_TITLES } from "./reminder_generation.constants.ts";

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

interface PolicyRow {
  id: string;
  policyNumber?: string | null;
  nextPaymentDate?: string | null;
  renewalDate?: string | null;
  endDate?: string | null;
  startDate?: string | null;
}

// Returns "YYYY-MM-DDT00:00:00±HH:MM" — local midnight in the advisor's timezone.
// Storing local midnight in a timestamptz column means Flutter's .toLocal() gives
// back the same date with hour=0, which _formatFecha shows correctly and _formatHora shows as '—'.
function toLocalMidnight(dateStr: string, timezoneOffset: string): string {
  return `${dateStr.substring(0, 10)}T00:00:00${timezoneOffset}`;
}

function nextAnniversary(startDate: string, timezoneOffset: string): string {
  const base = new Date(startDate);
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  const next = new Date(base);
  next.setFullYear(today.getFullYear());
  next.setHours(0, 0, 0, 0);

  // If the anniversary already passed this year (strictly before today), use next year.
  // If it's today or later, keep the current-year date.
  if (next < today) next.setFullYear(today.getFullYear() + 1);
  return toLocalMidnight(next.toISOString().split("T")[0], timezoneOffset);
}

export class ReminderGenerationService {
  constructor(private readonly repository: IReminderGenerationRepository) {}

  async generateForPolicy(policy: PolicyRow, agentId: string, timezoneOffset = "-06:00"): Promise<ReminderGenerationResult> {
    const policyLabel = policy.policyNumber ?? "póliza";
    const candidates: Array<{ typeCode: string; title: string; dueDate: string }> = [];

    if (policy.nextPaymentDate) {
      candidates.push({
        typeCode: "PAYMENT",
        title: (REMINDER_TITLES["PAYMENT"]?.(policyLabel)) ?? policyLabel,
        dueDate: toLocalMidnight(policy.nextPaymentDate, timezoneOffset),
      });
    }

    const renewalDate = policy.renewalDate ?? policy.endDate;
    if (renewalDate) {
      candidates.push({
        typeCode: "RENEWAL",
        title: (REMINDER_TITLES["RENEWAL"]?.(policyLabel)) ?? policyLabel,
        dueDate: toLocalMidnight(renewalDate, timezoneOffset),
      });
    }

    if (policy.startDate) {
      candidates.push({
        typeCode: "ANNIVERSARY",
        title: (REMINDER_TITLES["ANNIVERSARY"]?.(policyLabel)) ?? policyLabel,
        dueDate: nextAnniversary(policy.startDate, timezoneOffset),
      });
    }

    if (candidates.length === 0) return { created: [], existing: [] };

    // Load all needed status IDs in a single query.
    const statusIds = await this.repository.findStatusIdsByCodes(["DONE", "CANCELLED", "CREATED"]);
    const createdStatusId = statusIds["CREATED"];
    if (!createdStatusId) {
      console.error("[ReminderGenerationService] CREATED status not found in reminder_statuses");
      return { created: [], existing: [] };
    }
    const closedStatusIds = ["DONE", "CANCELLED"].flatMap((c) => (statusIds[c] ? [statusIds[c]] : []));

    const types = await this.repository.findReminderTypesByCodes(candidates.map((c) => c.typeCode));
    if (types.length === 0) return { created: [], existing: [] };

    const typeMap = new Map(types.map((t) => [t.code, t]));
    const created: GeneratedReminder[] = [];
    const existing: GeneratedReminder[] = [];

    for (const candidate of candidates) {
      const type = typeMap.get(candidate.typeCode);
      if (!type) continue;

      const existingRow = await this.repository.findExistingReminder(agentId, policy.id, type.id, closedStatusIds);
      if (existingRow) {
        existing.push({
          id: existingRow.id,
          typeCode: candidate.typeCode,
          typeName: type.name,
          title: existingRow.title,
          dueDate: existingRow.dueDate,
          isNew: false,
        });
      } else {
        const id = await this.repository.createReminder({
          agentId,
          policyId: policy.id,
          typeId: type.id,
          title: candidate.title,
          dueDate: candidate.dueDate,
        }, createdStatusId);
        if (id) {
          created.push({
            id,
            typeCode: candidate.typeCode,
            typeName: type.name,
            title: candidate.title,
            dueDate: candidate.dueDate,
            isNew: true,
          });
        }
      }
    }

    return { created, existing };
  }
}
