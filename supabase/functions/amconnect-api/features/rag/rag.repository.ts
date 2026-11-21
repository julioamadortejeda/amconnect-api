import { SupabaseClient } from "@supabase/supabase-js";
import { handleSupabaseError } from "../../shared/errors.ts";

export interface NoteMatch {
  chunkId: string;
  noteId: string;
  content: string;
  contactId: string | null;
  policyId: string | null;
  reminderId?: string | null;
  similarity: number;
  sourceType: string;
  createdAt: string;
  // Documento adjunto a la nota (si lo tiene) — habilita el botón "abrir
  // archivo" cuando la nota se encuentra por búsqueda vectorial.
  storagePath: string | null;
  fileName: string | null;
}

export interface SearchNoteChunksOptions {
  contactId?: string;
  policyId?: string;
  reminderId?: string;
}

/** Filtros de las búsquedas de `recall` (exacta y de texto). */
export interface RecallChunkFilters extends SearchNoteChunksOptions {
  /** `agent_notes.source_type` permitidos; sin él, todos. */
  sourceTypes?: readonly string[];
}

export interface IRagRepository {
  searchNoteChunks(
    agentId: string,
    queryEmbedding: string,
    threshold: number,
    limit: number,
    options?: SearchNoteChunksOptions,
  ): Promise<NoteMatch[]>;
  /** Vectorial EXACTA (sin HNSW), orden estable: distancia y luego `id`. */
  searchNoteChunksExact(
    agentId: string,
    queryEmbedding: string,
    threshold: number,
    limit: number,
    filters?: RecallChunkFilters,
  ): Promise<NoteMatch[]>;
  /** Texto completo. `similarity` es la relevancia léxica, no un coseno. */
  searchNoteChunksText(agentId: string, query: string, limit: number, filters?: RecallChunkFilters): Promise<NoteMatch[]>;
}

export class RagRepository implements IRagRepository {
  constructor(private supabase: SupabaseClient) {}

  async searchNoteChunks(
    agentId: string,
    queryEmbedding: string,
    threshold: number,
    limit: number,
    options?: SearchNoteChunksOptions,
  ): Promise<NoteMatch[]> {
    // Los filtros van DENTRO de la función SQL, antes del LIMIT. Aplicarlos con
    // `.eq(...)` sobre el resultado de la RPC filtraba los N fragmentos más
    // parecidos de TODO el asesor y la búsqueda acotada volvía vacía cuando
    // esos N eran de otros clientes (migración 20261120235540_rag_scoped_search).
    const { data, error } = await this.supabase.rpc("search_agent_note_chunks", {
      p_agent_id: agentId,
      p_query_embedding: queryEmbedding,
      p_match_threshold: threshold,
      p_match_count: limit,
      p_contact_id: options?.contactId ?? null,
      p_policy_id: options?.policyId ?? null,
      p_reminder_id: options?.reminderId ?? null,
    });

    // Un fallo de BD NO debe presentarse como "sin resultados": propagar por el
    // contrato de errores (RULES §2) en vez de `return []`.
    if (error) handleSupabaseError(error, "Error al buscar notas por similitud");

    return await this.toMatches(data);
  }

  async searchNoteChunksExact(
    agentId: string,
    queryEmbedding: string,
    threshold: number,
    limit: number,
    filters?: RecallChunkFilters,
  ): Promise<NoteMatch[]> {
    const { data, error } = await this.supabase.rpc("search_agent_note_chunks_exact", {
      p_agent_id: agentId,
      p_query_embedding: queryEmbedding,
      p_match_threshold: threshold,
      p_match_count: limit,
      p_source_types: filters?.sourceTypes ? [...filters.sourceTypes] : null,
      p_contact_id: filters?.contactId ?? null,
      p_policy_id: filters?.policyId ?? null,
      p_reminder_id: filters?.reminderId ?? null,
    });
    if (error) handleSupabaseError(error, "Error en la búsqueda exacta de notas");
    return await this.toMatches(data);
  }

  async searchNoteChunksText(
    agentId: string,
    query: string,
    limit: number,
    filters?: RecallChunkFilters,
  ): Promise<NoteMatch[]> {
    const { data, error } = await this.supabase.rpc("search_agent_note_chunks_text", {
      p_agent_id: agentId,
      p_query: query,
      p_match_count: limit,
      p_source_types: filters?.sourceTypes ? [...filters.sourceTypes] : null,
      p_contact_id: filters?.contactId ?? null,
      p_policy_id: filters?.policyId ?? null,
      p_reminder_id: filters?.reminderId ?? null,
    });
    if (error) handleSupabaseError(error, "Error en la búsqueda de texto de notas");
    return await this.toMatches(data);
  }

  private async toMatches(data: unknown): Promise<NoteMatch[]> {
    const matches: NoteMatch[] = ((data as Record<string, unknown>[] | null) ?? []).map((r) => ({
      chunkId: r.chunk_id as string,
      noteId: r.note_id as string,
      content: r.content as string,
      contactId: r.contact_id as string | null,
      policyId: r.policy_id as string | null,
      reminderId: r.reminder_id as string | null,
      similarity: r.similarity as number,
      sourceType: r.source_type as string,
      createdAt: r.created_at as string,
      storagePath: null,
      fileName: null,
    }));

    await this.attachDocuments(matches);
    return matches;
  }

  // Resuelve el documento adjunto de cada nota en TypeScript (RULES §6: no
  // ampliar la RPC para lo que se puede resolver aquí). Reutiliza el mismo join
  // embebido `document_metadata(storage_path, file_name)` que NoteRepository, y
  // el RLS de agent_notes filtra por agente automáticamente.
  private async attachDocuments(matches: NoteMatch[]): Promise<void> {
    const noteIds = [...new Set(matches.map((m) => m.noteId))];
    if (noteIds.length === 0) return;

    const { data, error } = await this.supabase
      .from("agent_notes")
      .select("id, document_metadata(storage_path, file_name)")
      .in("id", noteIds);

    if (error) handleSupabaseError(error, "Error al obtener adjuntos de notas");

    const byNote = new Map<string, { storagePath: string | null; fileName: string | null }>();
    for (const row of (data ?? []) as Record<string, unknown>[]) {
      const dm = row.document_metadata as Record<string, unknown> | Record<string, unknown>[] | null;
      const meta = Array.isArray(dm) ? dm[0] : dm;
      if (meta) {
        byNote.set(row.id as string, {
          storagePath: (meta.storage_path as string) ?? null,
          fileName: (meta.file_name as string) ?? null,
        });
      }
    }

    for (const m of matches) {
      const meta = byNote.get(m.noteId);
      if (meta) {
        m.storagePath = meta.storagePath;
        m.fileName = meta.fileName;
      }
    }
  }
}
