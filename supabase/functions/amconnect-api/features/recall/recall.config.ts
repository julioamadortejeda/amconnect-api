// Constantes de `recall` (D-012, D-013). Valores iniciales a ajustar con el set
// de evaluación; ningún otro archivo del módulo lleva números de negocio.

/** Resultados por grupo y por página (en notas/documentos, DOCUMENTOS por página). */
export const RECALL_GROUP_LIMIT = 10;
/** Fragmentos que se muestran de un mismo documento; el resto se marca `moreInDocument`. */
export const RECALL_MAX_PER_DOCUMENT = 5;
/** Fragmentos candidatos por búsqueda (vectorial y de texto) en notas/documentos. */
export const RECALL_CANDIDATES = 50;
/** Tope duro de candidatos al pedir páginas profundas. */
export const RECALL_MAX_CANDIDATES = 300;
/** Presupuesto de la respuesta al modelo. */
export const RECALL_WORD_BUDGET = 4000;
/** Constante de RRF (valor estándar de la literatura). */
export const RRF_K = 60;
/** Vigencia de una búsqueda guardada (embedding de la consulta). */
export const RECALL_SEARCH_TTL_MINUTES = 30;
/** Máximo de caracteres de un fragmento que se entrega al modelo. */
export const RECALL_CHUNK_MAX_CHARS = 1200;
