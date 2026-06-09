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
  policyNumber?: string | null;
  nextPaymentDate?: string | null;
  renewalDate?: string | null;
  endDate?: string | null;
  startDate?: string | null;
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
    const policyLabel = policy.policyNumber ?? "póliza";
    const candidates: Array<{ typeCode: string; title: string; dueDate: string }> = [];

    if (policy.nextPaymentDate) {
      candidates.push({
        typeCode: "PAYMENT",
        title: `Pago de Prima · ${policyLabel}`,
        dueDate: policy.nextPaymentDate,
      });
    }

    const renewalDate = policy.renewalDate ?? policy.endDate;
    if (renewalDate) {
      candidates.push({
        typeCode: "RENEWAL",
        title: `Renovación · ${policyLabel}`,
        dueDate: renewalDate,
      });
    }

    if (policy.startDate) {
      candidates.push({
        typeCode: "ANIVERSARIO",
        title: `Aniversario · ${policyLabel}`,
        dueDate: nextAnniversary(policy.startDate),
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
