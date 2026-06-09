import type { IReminderGenerationRepository } from "./reminder_generation.repository.ts";

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
  policy_number?: string | null;
  next_payment_date?: string | null;
  renewal_date?: string | null;
  end_date?: string | null;
  start_date?: string | null;
}

function nextAnniversary(startDate: string): string {
  const base = new Date(startDate);
  const now = new Date();
  const next = new Date(base);
  next.setFullYear(now.getFullYear());
  if (next <= now) next.setFullYear(now.getFullYear() + 1);
  return next.toISOString().split("T")[0];
}

export class ReminderGenerationService {
  constructor(private readonly repository: IReminderGenerationRepository) {}

  async generateForPolicy(policy: PolicyRow, agentId: string): Promise<ReminderGenerationResult> {
    const policyLabel = policy.policy_number ?? "póliza";
    const candidates: Array<{ typeCode: string; title: string; dueDate: string }> = [];

    if (policy.next_payment_date) {
      candidates.push({
        typeCode: "PAGO",
        title: `Pago de Prima · ${policyLabel}`,
        dueDate: policy.next_payment_date,
      });
    }

    const renewalDate = policy.renewal_date ?? policy.end_date;
    if (renewalDate) {
      candidates.push({
        typeCode: "RENOVACION",
        title: `Renovación · ${policyLabel}`,
        dueDate: renewalDate,
      });
    }

    if (policy.start_date) {
      candidates.push({
        typeCode: "ANNIVERSARY",
        title: `Aniversario · ${policyLabel}`,
        dueDate: nextAnniversary(policy.start_date),
      });
    }

    if (candidates.length === 0) return { created: [], existing: [] };

    const types = await this.repository.findReminderTypesByCodes(candidates.map((c) => c.typeCode));
    if (types.length === 0) return { created: [], existing: [] };

    const typeMap = new Map(types.map((t) => [t.code, t]));
    const created: GeneratedReminder[] = [];
    const existing: GeneratedReminder[] = [];

    for (const candidate of candidates) {
      const type = typeMap.get(candidate.typeCode);
      if (!type) continue;

      const existingRow = await this.repository.findExistingReminder(agentId, policy.id, type.id);
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
        });
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
