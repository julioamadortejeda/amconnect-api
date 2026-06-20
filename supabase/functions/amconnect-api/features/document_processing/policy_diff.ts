import type { PolicyResponseDTO } from "../../modules/policy/policy.dto.ts";
import type { PolicyExtraction } from "./policy_extraction.schema.ts";

export interface PolicyChange {
  field: string;
  label: string;
  oldValue: string | null;
  newValue: string | null;
}

type Scalar = string | number | null | undefined;

function normalize(v: Scalar): string | null {
  if (v === null || v === undefined || v === '') return null;
  return String(v);
}

export function diffPolicy(existing: PolicyResponseDTO, extracted: PolicyExtraction): PolicyChange[] {
  const changes: PolicyChange[] = [];

  const compare = (field: string, label: string, oldVal: Scalar, newVal: Scalar) => {
    const o = normalize(oldVal);
    const n = normalize(newVal);
    if (n !== null && o !== n) {
      changes.push({ field, label, oldValue: o, newValue: n });
    }
  };

  compare('startDate', 'Start Date', existing.startDate, extracted.startDate);
  compare('endDate', 'End Date', existing.endDate, extracted.endDate);
  compare('renewalDate', 'Renewal Date', existing.renewalDate, extracted.renewalDate);
  compare('nextPaymentDate', 'Next Payment Date', existing.nextPaymentDate, extracted.nextPaymentDate);
  compare('premium', 'Premium', existing.premium, extracted.premium);
  compare('sumInsured', 'Sum Insured', existing.sumInsured, extracted.sumInsured);
  compare('deductible', 'Deductible', existing.deductible, extracted.globalDeductible);
  compare('notes', 'Notes', existing.notes, extracted.notes);

  return changes;
}

export function buildChangelogContent(
  policyNumber: string,
  changes: PolicyChange[],
  newSummary: string,
): string {
  const date = new Date().toISOString().split('T')[0];
  const changeLines = changes.length > 0
    ? changes.map(c => `- ${c.label}: "${c.oldValue ?? '—'}" → "${c.newValue}"`)
    : ['- No field differences detected (document was re-processed)'];

  return [
    `Policy update changelog — ${policyNumber} — ${date}`,
    '',
    'Changes recorded:',
    ...changeLines,
    '',
    'Updated policy summary:',
    newSummary,
  ].join('\n');
}

export function buildCoveragesNote(extraction: PolicyExtraction): string | null {
  if (extraction.coverages.length === 0) return null;

  const header = [extraction.policyNumber, extraction.productName, extraction.carrierName]
    .filter(Boolean)
    .join(' – ');

  const lines = extraction.coverages.map((c) => {
    let line = `- ${c.name}`;
    if (c.description) line += `: ${c.description}`;
    if (c.amount != null) line += ` (${c.amount} ${extraction.currency ?? 'MXN'})`;
    return line;
  });

  return `Coberturas de póliza ${header}:\n${lines.join('\n')}`;
}
