import type { Searchable, SearchHit, SearchOptions } from "../../shared/search_hits.ts";
import type { ContactResponseDTO } from "../../modules/contact/contact.dto.ts";
import type { PolicyResponseDTO } from "../../modules/policy/policy.dto.ts";
import type { ReminderResponseDTO } from "../../modules/reminder/reminder.dto.ts";
import type { CommitmentResponseDTO } from "../commitments/commitment.dto.ts";
import type { NoteMatch } from "../rag/rag.repository.ts";
import { capPerDocument } from "./cap_per_document.ts";
import { fetchSizeFor } from "./paginate.ts";
import { paginateWithBudget } from "./paginate_budget.ts";
import { rrfMerge } from "./rrf.ts";
import {
  RECALL_CANDIDATES,
  RECALL_CHUNKS_PER_PAGE,
  RECALL_GROUP_LIMIT,
  RECALL_MAX_CANDIDATES,
  RECALL_MAX_PER_DOCUMENT,
  RECALL_WORD_BUDGET,
} from "./recall.config.ts";
import {
  DOCUMENT_SOURCE_TYPES,
  NOTE_SOURCE_TYPES,
  RECALL_GROUPS,
  type RecallDocument,
  type RecallGroup,
  type RecallWeigh,
  type RecallGroups,
  type RecallParams,
  type RecallResult,
} from "./recall.types.ts";
import type { RecallSearchService } from "./recall_search.service.ts";

/** Lo que necesita del RAG: vector y texto, ambos por fragmento. */
export interface NoteSearchSource extends Searchable<NoteMatch> {
  searchTextHits(agentId: string, query: string, opts?: SearchOptions): Promise<SearchHit<NoteMatch>[]>;
}

export interface RecallSources {
  contacts: Searchable<ContactResponseDTO>;
  policies: Searchable<PolicyResponseDTO>;
  reminders: Searchable<ReminderResponseDTO>;
  commitments: Searchable<CommitmentResponseDTO>;
  notes: NoteSearchSource;
}

/**
 * Orquestador de `recall` (D-013). No busca ni formatea: obtiene el embedding de
 * la consulta (reutilizable entre páginas), llama a las fuentes EN PARALELO y
 * conecta las funciones puras (rrfMerge, capPerDocument, paginateWithBudget).
 * Si una fuente falla, `Promise.all` rechaza y el error sube: un grupo caído
 * nunca se entrega como "sin resultados". `weigh` dice cuántas palabras ocupa un
 * elemento en lo que ve el modelo (lo da el mapper); con él la paginación
 * respeta el presupuesto y lo que no cabe abre la página siguiente.
 */
export class RecallService {
  constructor(
    private sources: RecallSources,
    private searches: RecallSearchService,
    private weigh: RecallWeigh,
    private maxWords = RECALL_WORD_BUDGET,
  ) {}

  async recall(agentId: string, params: RecallParams): Promise<RecallResult> {
    const page = Number.isInteger(params.page) && (params.page as number) >= 1 ? params.page as number : 1;
    if (params.noteId) return await this.withinDocument(agentId, params, params.noteId, page);

    // Con cliente acotado el contacto ya se conoce: no se vuelve a buscar.
    // Orden fijo (RECALL_GROUPS): las rondas del presupuesto son deterministas.
    const requested = new Set(params.groups?.length ? params.groups : RECALL_GROUPS);
    const groups = RECALL_GROUPS.filter((g) => requested.has(g) && !(params.contactId && g === "contacts"));

    // Solo las notas/documentos necesitan el vector.
    const needsEmbedding = groups.includes("notes") || groups.includes("documents");
    const search = needsEmbedding ? await this.searches.resolve(agentId, params.query, params.searchId) : null;

    const base: SearchOptions = { contactId: params.contactId };
    const structuredLimit = fetchSizeFor(page, RECALL_GROUP_LIMIT);
    const structured = async <T>(source: Searchable<T>): Promise<T[]> =>
      (await source.searchHits(agentId, params.query, { ...base, limit: structuredLimit })).map((h) => h.item);

    // Todo lo que cada grupo puede aportar hasta esta página, sin paginar todavía.
    const entries = await Promise.all(
      groups.map(async (group): Promise<[RecallGroup, unknown[]]> => {
        switch (group) {
          case "contacts":
            return [group, await structured(this.sources.contacts)];
          case "policies":
            return [group, await structured(this.sources.policies)];
          case "reminders":
            return [group, await structured(this.sources.reminders)];
          case "commitments":
            return [group, await structured(this.sources.commitments)];
          case "notes":
            return [group, await this.noteDocuments(agentId, params.query, base, search!.embedding, NOTE_SOURCE_TYPES, page)];
          case "documents":
            return [group, await this.noteDocuments(agentId, params.query, base, search!.embedding, DOCUMENT_SOURCE_TYPES, page)];
        }
      }),
    );

    const paged = paginateWithBudget(
      Object.fromEntries(entries),
      page,
      RECALL_GROUP_LIMIT,
      this.maxWords,
      (group, item) => this.weigh(group as RecallGroup, item),
    );

    return { searchId: search?.searchId ?? "", page, groups: paged as RecallGroups };
  }

  /** Vector + texto en paralelo, RRF y tope por documento: todos los documentos candidatos. */
  private async noteDocuments(
    agentId: string,
    query: string,
    base: SearchOptions,
    queryEmbedding: number[],
    sourceTypes: readonly string[],
    page: number,
  ): Promise<RecallDocument[]> {
    const candidates = Math.min(
      RECALL_MAX_CANDIDATES,
      Math.max(RECALL_CANDIDATES, fetchSizeFor(page, RECALL_GROUP_LIMIT) * RECALL_MAX_PER_DOCUMENT),
    );
    const merged = await this.hybridChunks(agentId, query, { ...base, sourceTypes, limit: candidates }, queryEmbedding);
    return capPerDocument(merged, (h) => h.item.noteId, RECALL_MAX_PER_DOCUMENT).map((d) =>
      toDocument(d.hits.map((h) => h.item), d.moreInDocument)
    );
  }

  private async hybridChunks(
    agentId: string,
    query: string,
    opts: SearchOptions,
    queryEmbedding: number[],
  ): Promise<SearchHit<NoteMatch>[]> {
    const [vector, text] = await Promise.all([
      this.sources.notes.searchHits(agentId, query, { ...opts, queryEmbedding }),
      this.sources.notes.searchTextHits(agentId, query, opts),
    ]);
    return rrfMerge([vector, text]);
  }

  /**
   * "Más de este documento": la misma búsqueda híbrida limitada a UN note_id,
   * SIN tope por documento. La unidad de página es el fragmento. El RLS acota:
   * un note_id ajeno no devuelve nada.
   */
  private async withinDocument(agentId: string, params: RecallParams, noteId: string, page: number): Promise<RecallResult> {
    const search = await this.searches.resolve(agentId, params.query, params.searchId);
    const candidates = Math.min(RECALL_MAX_CANDIDATES, Math.max(RECALL_CANDIDATES, fetchSizeFor(page, RECALL_CHUNKS_PER_PAGE)));
    const merged = await this.hybridChunks(
      agentId,
      params.query,
      { contactId: params.contactId, noteId, limit: candidates },
      search.embedding,
    );
    const chunks = merged.map((h) => h.item);
    const paged = paginateWithBudget(
      { chunks },
      page,
      RECALL_CHUNKS_PER_PAGE,
      this.maxWords,
      (_g, chunk) => this.weigh("chunks", chunk),
    ).chunks;

    const group: RecallGroup = chunks[0]?.sourceType === "text" ? "notes" : "documents";
    const items = paged.items.length > 0 ? [toDocument(paged.items, paged.moreAvailable)] : [];
    return {
      searchId: search.searchId,
      page,
      groups: { [group]: { items, moreAvailable: paged.moreAvailable } },
    };
  }
}

function toDocument(chunks: NoteMatch[], moreInDocument: boolean): RecallDocument {
  const first = chunks[0];
  return {
    noteId: first.noteId,
    sourceType: first.sourceType,
    fileName: first.fileName,
    contactId: first.contactId,
    policyId: first.policyId,
    reminderId: first.reminderId ?? null,
    createdAt: first.createdAt,
    chunks,
    moreInDocument,
  };
}
