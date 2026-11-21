import type { Searchable, SearchHit, SearchOptions } from "../../shared/search_hits.ts";
import type { ContactResponseDTO } from "../../modules/contact/contact.dto.ts";
import type { PolicyResponseDTO } from "../../modules/policy/policy.dto.ts";
import type { ReminderResponseDTO } from "../../modules/reminder/reminder.dto.ts";
import type { CommitmentResponseDTO } from "../commitments/commitment.dto.ts";
import type { NoteMatch } from "../rag/rag.repository.ts";
import { capPerDocument } from "./cap_per_document.ts";
import { fetchSizeFor, paginate } from "./paginate.ts";
import { rrfMerge } from "./rrf.ts";
import { RECALL_CANDIDATES, RECALL_GROUP_LIMIT, RECALL_MAX_CANDIDATES, RECALL_MAX_PER_DOCUMENT } from "./recall.config.ts";
import {
  DOCUMENT_SOURCE_TYPES,
  NOTE_SOURCE_TYPES,
  RECALL_GROUPS,
  type RecallDocument,
  type RecallGroup,
  type RecallGroupResult,
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
 * conecta las funciones puras (rrfMerge, capPerDocument, paginate). Si una fuente
 * falla, `Promise.all` rechaza y el error sube: un grupo caído nunca se entrega
 * como "sin resultados". El presupuesto de tamaño lo aplica el mapper, que es
 * quien conoce lo que ve el modelo.
 */
export class RecallService {
  constructor(private sources: RecallSources, private searches: RecallSearchService) {}

  async recall(agentId: string, params: RecallParams): Promise<RecallResult> {
    const page = Number.isInteger(params.page) && (params.page as number) >= 1 ? params.page as number : 1;
    // Con cliente acotado el contacto ya se conoce: no se vuelve a buscar.
    const wanted = (params.groups?.length ? params.groups : [...RECALL_GROUPS])
      .filter((g) => !(params.contactId && g === "contacts"));
    const groups = [...new Set(wanted)];

    // Solo las notas/documentos necesitan el vector.
    const needsEmbedding = groups.includes("notes") || groups.includes("documents");
    const search = needsEmbedding
      ? await this.searches.resolve(agentId, params.query, params.searchId)
      : null;

    const base: SearchOptions = { contactId: params.contactId };
    const structuredLimit = fetchSizeFor(page, RECALL_GROUP_LIMIT);

    const entries = await Promise.all(
      groups.map(async (group): Promise<[RecallGroup, RecallGroupResult<unknown>]> => {
        switch (group) {
          case "contacts":
            return [group, this.structured(await this.sources.contacts.searchHits(agentId, params.query, { ...base, limit: structuredLimit }), page)];
          case "policies":
            return [group, this.structured(await this.sources.policies.searchHits(agentId, params.query, { ...base, limit: structuredLimit }), page)];
          case "reminders":
            return [group, this.structured(await this.sources.reminders.searchHits(agentId, params.query, { ...base, limit: structuredLimit }), page)];
          case "commitments":
            return [group, this.structured(await this.sources.commitments.searchHits(agentId, params.query, { ...base, limit: structuredLimit }), page)];
          case "notes":
            return [group, await this.noteGroup(agentId, params.query, base, search!.embedding, NOTE_SOURCE_TYPES, page)];
          case "documents":
            return [group, await this.noteGroup(agentId, params.query, base, search!.embedding, DOCUMENT_SOURCE_TYPES, page)];
        }
      }),
    );

    return {
      searchId: search?.searchId ?? "",
      page,
      groups: Object.fromEntries(entries) as RecallGroups,
    };
  }

  private structured<T>(hits: SearchHit<T>[], page: number): RecallGroupResult<T> {
    const { items, moreAvailable } = paginate(hits, page, RECALL_GROUP_LIMIT);
    return { items: items.map((h) => h.item), moreAvailable };
  }

  /** Vector + texto en paralelo, RRF, tope por documento y página de documentos. */
  private async noteGroup(
    agentId: string,
    query: string,
    base: SearchOptions,
    queryEmbedding: number[],
    sourceTypes: readonly string[],
    page: number,
  ): Promise<RecallGroupResult<RecallDocument>> {
    const candidates = Math.min(
      RECALL_MAX_CANDIDATES,
      Math.max(RECALL_CANDIDATES, fetchSizeFor(page, RECALL_GROUP_LIMIT) * RECALL_MAX_PER_DOCUMENT),
    );
    const opts: SearchOptions = { ...base, sourceTypes, limit: candidates };
    const [vector, text] = await Promise.all([
      this.sources.notes.searchHits(agentId, query, { ...opts, queryEmbedding }),
      this.sources.notes.searchTextHits(agentId, query, opts),
    ]);

    const merged = rrfMerge([vector, text]);
    const documents = capPerDocument(merged, (h) => h.item.noteId, RECALL_MAX_PER_DOCUMENT);
    const { items, moreAvailable } = paginate(documents, page, RECALL_GROUP_LIMIT);

    return {
      moreAvailable,
      items: items.map((d) => {
        const first = d.hits[0].item;
        return {
          noteId: d.documentId,
          sourceType: first.sourceType,
          fileName: first.fileName,
          contactId: first.contactId,
          policyId: first.policyId,
          reminderId: first.reminderId ?? null,
          createdAt: first.createdAt,
          chunks: d.hits.map((h) => h.item),
          moreInDocument: d.moreInDocument,
        };
      }),
    };
  }
}
