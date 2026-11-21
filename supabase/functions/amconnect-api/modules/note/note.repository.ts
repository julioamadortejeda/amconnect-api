import { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseRepository } from "../../core/base_repository.ts";
import { ConflictError, handleSupabaseError, NotFoundError } from "../../shared/errors.ts";
import type { PaginatedResult } from "../../core/repository.interface.ts";
import { buildPage, buildPageByLookahead, pageRange } from "../../shared/pagination.ts";
import { NoteResponseDTO, PolicyNoteRow, RecentNoteRow } from "./note.dto.ts";

export type { NoteResponseDTO, PolicyNoteRow, RecentNoteRow };

const NOTE_SELECT = `
  id, contact_id, policy_id, reminder_id, source_type, content, summary, note_origin, created_at,
  document_metadata(storage_path, file_name)
`.trim();

export class NoteRepository extends SupabaseRepository<NoteResponseDTO> {
  constructor(supabase: SupabaseClient) {
    super(supabase, "agent_notes", NOTE_SELECT);
  }

  async getByContactId(contactId: string, page: number, pageSize: number): Promise<PaginatedResult<NoteResponseDTO>> {
    const { from, to } = pageRange(page, pageSize);
    const { data, error, count } = await this.supabase
      .from("agent_notes")
      .select(NOTE_SELECT, { count: "exact" })
      .eq("contact_id", contactId)
      .eq("is_active", true)
      .eq("note_origin", "knowledge")
      // `id` desempata: sin él, notas con el mismo created_at saltan o se
      // repiten entre páginas.
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, to);

    if (error) handleSupabaseError(error, "Error al obtener notas del contacto");
    return buildPage((data ?? []) as unknown as NoteResponseDTO[], count ?? 0, page, pageSize);
  }

  async getByReminderId(reminderId: string, page: number, pageSize: number): Promise<PaginatedResult<NoteResponseDTO>> {
    const { from, to } = pageRange(page, pageSize);
    const { data, error, count } = await this.supabase
      .from("agent_notes")
      .select(NOTE_SELECT, { count: "exact" })
      .eq("reminder_id", reminderId)
      .eq("is_active", true)
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, to);

    if (error) handleSupabaseError(error, "Error al obtener notas del recordatorio");
    return buildPage((data ?? []) as unknown as NoteResponseDTO[], count ?? 0, page, pageSize);
  }

  /**
   * Notas de una póliza: primero las vigentes, luego las versiones obsoletas
   * que dejó una re-ingesta del PDF (`policy_updated`), cada grupo de la más
   * nueva a la más vieja. Una sola consulta para poder paginar el conjunto.
   */
  async getByPolicyId(policyId: string, page: number, pageSize: number): Promise<PaginatedResult<PolicyNoteRow>> {
    const { from, to } = pageRange(page, pageSize);
    const { data, error, count } = await this.supabase
      .from("agent_notes")
      .select("id, source_type, content, summary, created_at, is_active, document_metadata(storage_path, file_name)", { count: "exact" })
      .eq("policy_id", policyId)
      .eq("note_origin", "policy")
      .or("is_active.eq.true,and(is_active.eq.false,discard_reason.eq.policy_updated)")
      .order("is_active", { ascending: false })
      .order("created_at", { ascending: false })
      .order("id")
      .range(from, to);

    if (error) handleSupabaseError(error, "Error al obtener notas de la póliza");

    const rows = ((data ?? []) as unknown as Record<string, unknown>[]).map((r): PolicyNoteRow => ({
      id: r.id as string,
      source_type: r.source_type as string,
      created_at: r.created_at as string,
      isObsolete: r.is_active !== true,
      content: r.content as string | null,
      summary: r.summary as string | null,
      document_metadata: r.document_metadata as PolicyNoteRow["document_metadata"],
    }));
    return buildPage(rows, count ?? 0, page, pageSize);
  }

  async deleteNote(agentId: string, noteId: string): Promise<void> {
    const { data: note, error: fetchError } = await this.supabase
      .from("agent_notes")
      .select("id, is_active, discard_reason")
      .eq("id", noteId)
      .eq("agent_id", agentId)
      .eq("note_origin", "policy")
      .maybeSingle();

    if (fetchError) handleSupabaseError(fetchError, "Error al buscar la nota.");
    if (!note) throw new NotFoundError("Nota no encontrada.");

    if (note.is_active) {
      // Nota activa (creada a mano por el asesor) — soft-delete estándar.
      const { error } = await this.supabase
        .from("agent_notes")
        .update({ is_active: false, discard_reason: "user_deleted" })
        .eq("id", noteId);
      // Sin esto la app mostraba la nota como borrada cuando el UPDATE falló.
      if (error) handleSupabaseError(error, "note.deleteNote");
      return;
    }

    if (note.discard_reason === "policy_updated") {
      // Versión obsoleta tras re-ingesta de PDF — el asesor la limpia manualmente.
      const { error } = await this.supabase
        .from("agent_notes")
        .update({ discard_reason: "user_deleted" })
        .eq("id", noteId);
      if (error) handleSupabaseError(error, "note.deleteNote");
      return;
    }

    throw new ConflictError("Esta nota ya fue eliminada.");
  }

  async getNotesSummary(): Promise<Record<string, number>> {
    const [
      pdfRes,
      docRes,
      imgRes,
      audioRes,
      textRes,
      waRes,
      chatRes,
    ] = await Promise.all([
      this.supabase.from("agent_notes").select("*", { count: "exact", head: true }).eq("is_active", true).eq("source_type", "pdf"),
      this.supabase.from("agent_notes").select("*", { count: "exact", head: true }).eq("is_active", true).eq("source_type", "document"),
      this.supabase.from("agent_notes").select("*", { count: "exact", head: true }).eq("is_active", true).eq("source_type", "image"),
      this.supabase.from("agent_notes").select("*", { count: "exact", head: true }).eq("is_active", true).eq("source_type", "audio"),
      this.supabase.from("agent_notes").select("*", { count: "exact", head: true }).eq("is_active", true).eq("source_type", "text"),
      this.supabase.from("agent_notes").select("*", { count: "exact", head: true }).eq("is_active", true).eq("source_type", "whatsapp"),
      this.supabase.from("ai_sessions").select("*", { count: "exact", head: true }).eq("type", "chat"),
    ]);

    // Un conteo fallido no es 0 notas: la pantalla mostraría el resumen vacío.
    for (const res of [pdfRes, docRes, imgRes, audioRes, textRes, waRes, chatRes]) {
      if (res.error) handleSupabaseError(res.error, "note.getNotesSummary");
    }

    return {
      pdf: (pdfRes.count ?? 0) + (docRes.count ?? 0),
      image: imgRes.count ?? 0,
      audio: audioRes.count ?? 0,
      text: (textRes.count ?? 0) + (waRes.count ?? 0),
      chat: chatRes.count ?? 0,
    };
  }

  async searchNotes(page: number, pageSize: number, search?: string): Promise<PaginatedResult<RecentNoteRow>> {
    // RPC en vez de `.or()` de PostgREST: el texto de búsqueda va como
    // parámetro bindeado (sin riesgo de romper el filtro con comas/paréntesis)
    // y permite matchear también document_metadata.file_name via join —
    // `.or()` no puede cruzar tablas embebidas de forma limpia. Ver
    // migración `add_search_notes_function`.
    // deno-lint-ignore no-explicit-any
    const { data, error } = await (this.supabase.rpc as any)("search_notes", {
      p_query: search && search.trim().length > 0 ? search : null,
      // Una fila de más: la función SQL no cuenta, la sobrante solo dice si
      // hay otra página (ver buildPageByLookahead).
      p_limit: pageSize + 1,
      p_offset: pageRange(page, pageSize).from,
    });

    if (error) handleSupabaseError(error, "Error al buscar notas");

    // deno-lint-ignore no-explicit-any
    const rows = ((data ?? []) as any[]).map((row) => ({
      id: row.id,
      contact_id: row.contact_id,
      policy_id: row.policy_id,
      source_type: row.source_type,
      created_at: row.created_at,
      content: row.content,
      summary: row.summary,
      document_metadata: row.file_name
        ? { file_name: row.file_name, storage_path: row.storage_path }
        : null,
      contacts: row.full_name ? { full_name: row.full_name } : null,
    })) as RecentNoteRow[];
    return buildPageByLookahead(rows, page, pageSize);
  }
}
