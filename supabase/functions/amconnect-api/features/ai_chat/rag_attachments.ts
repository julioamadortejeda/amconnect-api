// Qué documentos se adjuntan a la respuesta del chat (metadata
// `attachment_list`). Dos fuentes: los hits del RAG con archivo y las notas del
// contexto de pantalla. Ver RULES §5 — el filtro autoritativo es la citación.
import type { AiChatContext } from "./ai.dto.ts";

// Skills de búsqueda vectorial que devuelven NoteMatch[]: sus resultados pueden
// traer documentos adjuntos que alimentan el attachment_list (botón "abrir
// archivo") aunque la nota se haya encontrado por similitud y no por pantalla.
export const RAG_SEARCH_SKILLS = ["search_knowledge", "search_contact_notes", "search_policy_notes", "search_reminder_notes"];

// Margen de relevancia para adjuntos: dentro de una misma búsqueda, solo se
// adjuntan resultados cuya similitud esté a lo sumo esta distancia por debajo
// del mejor match. Evita adjuntar documentos que apenas cruzaron el threshold
// absoluto pero no tienen relación real con la pregunta (ej. una póliza de
// otro ramo apareciendo junto al documento realmente citado en la respuesta),
// mientras conserva múltiples adjuntos cuando genuinamente son parecidos entre
// sí (ej. varios documentos de un mismo cliente en una pregunta de resumen).
const ATTACHMENT_RELEVANCE_GAP = 0.15;

// Marcador inline que el modelo agrega junto a cada hecho tomado de una nota
// RAG ([[cite:noteId]], instrucción en RAG SOURCE CITATION RULE del prompt).
// Es el filtro AUTORITATIVO de qué adjuntar — el score de similitud (threshold
// + ATTACHMENT_RELEVANCE_GAP) no discrimina bien para queries cortas/genéricas
// (ver historial en RULES.md §5); lo que el modelo realmente citó en su texto
// sí es confiable. Se extrae y se limpia del texto antes de guardarlo/mostrarlo.
const CITE_MARKER_RE = /\s?\[\[cite:([0-9a-fA-F-]{36})\]\]/g;

export function extractCitations(text: string): { displayText: string; citedNoteIds: Set<string> } {
  const citedNoteIds = new Set<string>();
  const displayText = text
    .replace(CITE_MARKER_RE, (_match, id: string) => {
      citedNoteIds.add(id);
      return "";
    })
    .replace(/[ \t]+\n/g, "\n")
    .trim();
  return { displayText, citedNoteIds };
}

/**
 * Junta, a lo largo de las vueltas de herramientas de un turno, los documentos
 * de los hits del RAG (dedupe por nota: puede haber varios chunks de la misma
 * nota en un mismo resultado).
 */
export class RagAttachmentCollector {
  private attachments: Record<string, unknown>[] = [];
  private seenIds = new Set<string>();

  /**
   * Cosecha los adjuntos del resultado de una skill. Devuelve `true` si fue
   * una búsqueda del RAG que volvió vacía — el turno siguiente se fuerza a
   * texto, sin herramientas.
   */
  harvest(skillName: string, response: unknown): { emptyRagSearch: boolean } {
    if (!RAG_SEARCH_SKILLS.includes(skillName) || !Array.isArray(response)) {
      return { emptyRagSearch: false };
    }
    // Filtrando por relevancia relativa al mejor match de esta búsqueda (ver
    // ATTACHMENT_RELEVANCE_GAP).
    const hits = response as Record<string, unknown>[];
    const similarities = hits
      .map((h) => h.similarity as number | undefined)
      .filter((s): s is number => typeof s === "number");
    const maxSimilarity = similarities.length > 0 ? Math.max(...similarities) : undefined;

    for (const hit of hits) {
      const storagePath = (hit.storagePath ?? hit.storage_path) as string | undefined;
      const id = (hit.noteId ?? hit.note_id ?? hit.id) as string | undefined;
      const similarity = hit.similarity as number | undefined;
      const isRelevantEnough = maxSimilarity === undefined || similarity === undefined ||
        similarity >= maxSimilarity - ATTACHMENT_RELEVANCE_GAP;
      if (storagePath && id && isRelevantEnough && !this.seenIds.has(id)) {
        this.seenIds.add(id);
        this.attachments.push({
          id,
          fileName: hit.fileName ?? hit.file_name ?? hit.summary ?? "Documento",
          storagePath,
          sourceType: hit.sourceType ?? hit.source_type ?? "document",
          summary: hit.summary ?? hit.content,
        });
      }
    }
    return { emptyRagSearch: response.length === 0 };
  }

  /**
   * La metadata `attachment_list` del turno, o `undefined` si no hay nada que
   * adjuntar.
   *
   * Filtro autoritativo: solo las notas RAG que el modelo citó. Si no citó
   * ninguna (respuesta sin RAG, o no cumplió la instrucción esta vez), se
   * conserva el set ya filtrado por relevancia relativa como resguardo — mejor
   * eso que ocultar adjuntos de golpe. Después, las notas con archivo del
   * contexto de pantalla.
   */
  buildAttachmentList(
    citedNoteIds: Set<string>,
    context?: AiChatContext | null,
  ): { type: "attachment_list"; attachments: Record<string, unknown>[] } | undefined {
    const citedRagAttachments = citedNoteIds.size > 0
      ? this.attachments.filter((a) => citedNoteIds.has(a.id as string))
      : this.attachments;

    const attachments: Record<string, unknown>[] = [...citedRagAttachments];
    const seenAttachmentIds = new Set(attachments.map((a) => a.id as string));

    if (context?.data?.notes && Array.isArray(context.data.notes)) {
      const contextAttachments = (context.data.notes as Record<string, unknown>[])
        .filter((n) => n.storage_path || n.storagePath || n.fileName || n.file_name)
        .map((n): Record<string, unknown> => ({
          id: n.id,
          fileName: n.fileName || n.file_name || n.summary || "Documento",
          storagePath: n.storagePath || n.storage_path,
          sourceType: n.sourceType || n.source_type || "document",
          summary: n.summary || n.content,
        }));
      for (const att of contextAttachments) {
        if (att.id && seenAttachmentIds.has(att.id as string)) continue;
        if (att.id) seenAttachmentIds.add(att.id as string);
        attachments.push(att);
      }
    }

    return attachments.length > 0 ? { type: "attachment_list", attachments } : undefined;
  }
}
