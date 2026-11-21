// Lo que el MODELO ve del resultado de `recall`. Solo forma: buscar, agrupar,
// paginar y combinar viven en RecallService y las funciones puras de features/recall.
import type { RecallDocument, RecallGroups, RecallResult } from "../../recall/recall.types.ts";
import { RECALL_CHUNK_MAX_CHARS, RECALL_WORD_BUDGET } from "../../recall/recall.config.ts";
import { applyBudget, countWords } from "../../recall/budget.ts";
import { slimContact } from "./contact.mapper.ts";
import { slimPolicy } from "./policy.mapper.ts";
import { slimReminder } from "./reminder.mapper.ts";
import { commitmentSummary } from "./commitment.mapper.ts";

const clip = (text: string): string =>
  text.length > RECALL_CHUNK_MAX_CHARS ? `${text.slice(0, RECALL_CHUNK_MAX_CHARS)}…` : text;

/** Un documento o nota con sus fragmentos, sin vectores ni puntajes. */
export const slimRecallDocument = (d: RecallDocument) => ({
  noteId: d.noteId,
  sourceType: d.sourceType,
  fileName: d.fileName,
  contactId: d.contactId,
  policyId: d.policyId,
  createdAt: d.createdAt,
  excerpts: d.chunks.map((c) => clip(c.content)),
  moreInDocument: d.moreInDocument,
});

export function recallResult(
  result: RecallResult,
  timezone: string,
  maxWords = RECALL_WORD_BUDGET,
) {
  const g: RecallGroups = result.groups;
  const mapped: Record<string, unknown[]> = {};
  if (g.contacts) mapped.contacts = g.contacts.items.map(slimContact);
  if (g.policies) mapped.policies = g.policies.items.map(slimPolicy);
  if (g.reminders) mapped.reminders = g.reminders.items.map((r) => slimReminder(r, timezone));
  if (g.commitments) mapped.commitments = g.commitments.items.map(commitmentSummary);
  if (g.notes) mapped.notes = g.notes.items.map(slimRecallDocument);
  if (g.documents) mapped.documents = g.documents.items.map(slimRecallDocument);

  const { groups: kept, omitted } = applyBudget(mapped, maxWords, (item) => countWords(JSON.stringify(item)));

  const out: Record<string, { items: unknown[]; moreAvailable: boolean }> = {};
  for (const name of Object.keys(kept)) {
    out[name] = { items: kept[name], moreAvailable: g[name as keyof RecallGroups]!.moreAvailable };
  }
  return {
    // Solo hay searchId si se buscó en notas/documentos (es el vector guardado).
    ...(result.searchId ? { searchId: result.searchId } : {}),
    page: result.page,
    groups: out,
    ...(Object.keys(omitted).length > 0 ? { omittedForSize: omitted } : {}),
  };
}
