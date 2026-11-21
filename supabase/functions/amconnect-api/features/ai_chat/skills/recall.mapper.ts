// Lo que el MODELO ve del resultado de `recall`. Solo forma: buscar, agrupar,
// paginar y combinar viven en RecallService y las funciones puras de features/recall.
import { RECALL_GROUPS, type RecallDocument, type RecallGroup, type RecallGroupResult, type RecallResult } from "../../recall/recall.types.ts";
import { RECALL_CHUNK_MAX_CHARS } from "../../recall/recall.config.ts";
import { countWords } from "../../recall/budget.ts";
import type { ContactResponseDTO } from "../../../modules/contact/contact.dto.ts";
import type { PolicyResponseDTO } from "../../../modules/policy/policy.dto.ts";
import type { ReminderResponseDTO } from "../../../modules/reminder/reminder.dto.ts";
import type { CommitmentResponseDTO } from "../../commitments/commitment.dto.ts";
import type { NoteMatch } from "../../rag/rag.repository.ts";
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

/**
 * Palabras que ocupa un elemento en lo que ve el modelo. Es la medida de
 * RecallService para paginar contra el presupuesto, así que usa la misma forma
 * que `recallResult` entrega. El huso horario solo cambia el largo de una fecha:
 * se fija en UTC para que las fronteras de página no dependan del asesor.
 */
export function weighRecallItem(group: RecallGroup | "chunks", item: unknown): number {
  return countWords(JSON.stringify(renderItem(group, item, "UTC")));
}

function renderItem(group: RecallGroup | "chunks", item: unknown, timezone: string): unknown {
  switch (group) {
    case "contacts":
      return slimContact(item as ContactResponseDTO);
    case "policies":
      return slimPolicy(item as PolicyResponseDTO);
    case "reminders":
      return slimReminder(item as ReminderResponseDTO, timezone);
    case "commitments":
      return commitmentSummary(item as CommitmentResponseDTO);
    case "notes":
    case "documents":
      return slimRecallDocument(item as RecallDocument);
    case "chunks":
      return clip((item as NoteMatch).content);
  }
}

/**
 * Solo da forma: qué entra en cada página y `moreAvailable` ya los decidió
 * RecallService (paginateWithBudget); aquí no se recorta nada.
 */
export function recallResult(result: RecallResult, timezone: string) {
  const out: Record<string, { items: unknown[]; moreAvailable: boolean }> = {};
  for (const group of RECALL_GROUPS) {
    const g = result.groups[group] as RecallGroupResult<unknown> | undefined;
    if (!g) continue;
    out[group] = { items: g.items.map((item) => renderItem(group, item, timezone)), moreAvailable: g.moreAvailable };
  }
  return {
    // Solo hay searchId si se buscó en notas/documentos (es el vector guardado).
    ...(result.searchId ? { searchId: result.searchId } : {}),
    page: result.page,
    groups: out,
  };
}
