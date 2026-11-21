export interface CappedDocument<H> {
  documentId: string;
  /** Fragmentos conservados, en el orden de entrada (máximo `maxPerDoc`). */
  hits: H[];
  /** true si al documento le sobraron fragmentos. */
  moreInDocument: boolean;
}

/**
 * Agrupa fragmentos por documento y conserva a lo más `maxPerDoc` de cada uno,
 * para que un documento largo no acapare el resultado (D-012). Los documentos
 * salen en el orden de su MEJOR fragmento (el primero que aparece en la entrada,
 * que ya viene ordenada por relevancia). Pura, sin I/O.
 */
export function capPerDocument<H>(
  hits: H[],
  documentIdOf: (hit: H) => string,
  maxPerDoc: number,
): CappedDocument<H>[] {
  const byDoc = new Map<string, CappedDocument<H>>();
  for (const hit of hits) {
    const id = documentIdOf(hit);
    let doc = byDoc.get(id);
    if (!doc) {
      doc = { documentId: id, hits: [], moreInDocument: false };
      byDoc.set(id, doc);
    }
    if (doc.hits.length < maxPerDoc) doc.hits.push(hit);
    else doc.moreInDocument = true;
  }
  return [...byDoc.values()];
}
