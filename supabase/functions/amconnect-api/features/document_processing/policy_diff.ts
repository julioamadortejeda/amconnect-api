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

// Deductible/coinsurance se guardan como texto libre ("$5,000,000", "10%") y
// el mismo valor puede llegar formateado distinto entre lo ya guardado y lo
// recién extraído del PDF (comas, símbolos) — comparamos solo los dígitos
// para no marcar como "cambio" algo que solo cambió de formato.
function normalizeNumericText(v: Scalar): string | null {
  const n = normalize(v);
  if (n === null) return null;
  const digitsOnly = n.replace(/[^0-9.]/g, '');
  return digitsOnly === '' ? n : digitsOnly;
}

// Campos de catálogo: comparamos por nombre/code en mayúsculas — la BD y el
// vocabulario de extracción de la IA usan los mismos códigos en inglés.
function normalizeCatalogText(v: Scalar): string | null {
  const n = normalize(v);
  return n === null ? null : n.toUpperCase();
}

// Traducciones para mostrarle al asesor un code de catálogo tipo "CREDIT_CARD"
// como "Tarjeta de Crédito" en vez de crudo — el resto del mensaje que arma
// la IA ya sale en español, así que un code en inglés se ve fuera de lugar.
// Mismas etiquetas que CatalogL10n en la app (amconnect-app/lib/core/utils/catalog_l10n.dart)
// para no tener dos traducciones distintas del mismo code.
const PAYMENT_METHOD_ES: Record<string, string> = {
  DIRECT_DEBIT: 'Domiciliación',
  BANK_TRANSFER: 'Transferencia Bancaria',
  CHECK: 'Cheque',
  CASH: 'Efectivo',
  CREDIT_CARD: 'Tarjeta de Crédito',
};

const PAYMENT_FREQUENCY_ES: Record<string, string> = {
  MONTHLY: 'Mensual',
  QUARTERLY: 'Trimestral',
  SEMIANNUAL: 'Semestral',
  ANNUAL: 'Anual',
};

const POLICY_STATUS_ES: Record<string, string> = {
  ACTIVE: 'Vigente',
  CANCELLED: 'Cancelada',
  EXPIRED: 'Vencida',
  PENDING: 'Pendiente',
  SUSPENDED: 'Suspendida',
};

function translateCatalogText(dictionary: Record<string, string>) {
  return (v: Scalar): string | null => {
    const n = normalize(v);
    if (n === null) return null;
    return dictionary[n.toUpperCase()] ?? n;
  };
}

export function diffPolicy(existing: PolicyResponseDTO, extracted: PolicyExtraction): PolicyChange[] {
  const changes: PolicyChange[] = [];

  const compare = (
    field: string,
    label: string,
    oldVal: Scalar,
    newVal: Scalar,
    normalizer: (v: Scalar) => string | null = normalize,
    display: (v: Scalar) => string | null = normalize,
  ) => {
    const o = normalizer(oldVal);
    const n = normalizer(newVal);
    if (n !== null && o !== n) {
      changes.push({ field, label, oldValue: display(oldVal), newValue: display(newVal) });
    }
  };

  compare('startDate', 'Start Date', existing.startDate, extracted.startDate);
  compare('endDate', 'End Date', existing.endDate, extracted.endDate);
  compare('renewalDate', 'Renewal Date', existing.renewalDate, extracted.renewalDate);
  compare('nextPaymentDate', 'Next Payment Date', existing.nextPaymentDate, extracted.nextPaymentDate);
  compare('premium', 'Premium', existing.premium, extracted.premium);
  compare('sumInsured', 'Sum Insured', existing.sumInsured, extracted.sumInsured);
  compare('deductible', 'Deductible', existing.deductible, extracted.globalDeductible, normalizeNumericText);
  compare('coinsurance', 'Coinsurance', existing.coinsurance, extracted.globalCoinsurance, normalizeNumericText);
  compare('seniorityDate', 'Seniority Date', existing.seniorityDate, extracted.seniorityDate);
  compare('insuredItem', 'Insured Item', existing.insuredItem, extracted.insuredItem);
  compare('policyVersion', 'Policy Version', existing.policyVersion, extracted.policyVersion);
  compare('paymentFrequency', 'Payment Frequency', existing.paymentFrequency?.name, extracted.paymentFrequency, normalizeCatalogText, translateCatalogText(PAYMENT_FREQUENCY_ES));
  compare('paymentMethod', 'Payment Method', existing.paymentMethod?.name, extracted.paymentMethod, normalizeCatalogText, translateCatalogText(PAYMENT_METHOD_ES));
  compare('status', 'Status', existing.status?.name, extracted.status, normalizeCatalogText, translateCatalogText(POLICY_STATUS_ES));
  compare('currency', 'Currency', existing.currency?.code, extracted.currency, normalizeCatalogText);
  // 'notes' se excluye a propósito: es texto libre que la IA regenera cada
  // vez que reprocesa el mismo documento, así que casi nunca coincide
  // carácter por carácter aunque el contenido real no haya cambiado.

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
