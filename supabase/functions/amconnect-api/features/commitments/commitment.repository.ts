import { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "../../types/supabase.ts";
import { handleSupabaseError } from "../../shared/errors.ts";
import { objectToCamelCaseDeep } from "../../shared/case_converter.ts";
import { CommitmentCloseResult, CommitmentListFilters, CommitmentResponseDTO } from "./commitment.dto.ts";

/// En UNA sola línea y con `as const` a propósito, por feo que se vea.
///
/// supabase-js parsea este string en tiempo de compilación para deducir la
/// forma de la fila, y solo puede hacerlo si es un tipo literal. Partirlo en
/// varias líneas con `+`, o construirlo con un template y `.trim()`, lo degrada
/// a `string` y el tipo de la respuesta cae en `GenericStringError`: se pierde
/// la validación de columnas y hay que castear la fila a mano.
const COMMITMENT_SELECT =
  "id, agent_id, contact_id, label, quote, due_from, due_to, status, resolution_note, resolved_at, resolved_by_session_id, created_at, contact:contacts(id, full_name)" as const;

export interface CommitmentInsert {
  agentId: string;
  contactId: string | null;
  label: string;
  quote: string;
  dueFrom: string | null;
  dueTo: string | null;
}

/**
 * Cambios parciales. `quote` NO está aquí a propósito: es la evidencia de lo que
 * el asesor dijo, y algo que se puede reescribir después deja de ser evidencia.
 */
export interface CommitmentUpdate {
  contactId?: string | null;
  label?: string;
  dueFrom?: string | null;
  dueTo?: string | null;
}

const toRow = (r: CommitmentInsert) => ({
  agent_id: r.agentId,
  contact_id: r.contactId,
  label: r.label,
  quote: r.quote,
  due_from: r.dueFrom,
  due_to: r.dueTo,
});

/**
 * Fila de PostgREST → DTO.
 *
 * `contact` es una relación a-uno, pero PostgREST no distingue cardinalidad en
 * el schema y la entrega envuelta en arreglo; se desenvuelve aquí para que las
 * tres consultas devuelvan la misma forma.
 *
 */
function toDto(row: Record<string, unknown>): CommitmentResponseDTO {
  const rel = row.contact;
  const contact = Array.isArray(rel) ? rel[0] : rel;
  return objectToCamelCaseDeep({ ...row, contact: contact ?? null }) as CommitmentResponseDTO;
}

export class CommitmentRepository {

  constructor(private supabase: SupabaseClient<Database>) {}

  /**
   * Devuelve la fila creada, a diferencia de un insert a secas: el
   * asistente tiene que poder confirmarle al asesor qué quedó guardado, con la
   * ventana ya resuelta a fechas.
   */
  async insertOne(row: CommitmentInsert): Promise<CommitmentResponseDTO> {
    const { data, error } = await this.supabase
      .from("client_commitments")
      .insert(toRow(row))
      .select(COMMITMENT_SELECT)
      .single();

    // handleSupabaseError y no internalError (RULES §2): mapea los códigos de
    // Postgres a errores útiles. Aquí importa de verdad — el modelo puede mandar
    // un contact_id inventado, y 23503 se vuelve "Referencia inválida" (400) en
    // vez de un 500 opaco que no le dice qué corregir.
    if (error) handleSupabaseError(error, "commitment insert");

    return toDto(data);
  }

  async list(agentId: string, filters: CommitmentListFilters): Promise<CommitmentResponseDTO[]> {
    let q = this.supabase
      .from("client_commitments")
      .select(COMMITMENT_SELECT)
      .eq("agent_id", agentId)
      .eq("is_active", true);

    // Los cerrados solo se listan cuando se piden: son para deshacer un cierre
    // equivocado, no parte de la agenda.
    q = filters.closedOnly
      ? q.neq("status", "OPEN")
      : q.eq("status", filters.status ?? "OPEN");

    if (filters.contactId) q = q.eq("contact_id", filters.contactId);

    // Un compromiso cae en la ventana consultada si su rango la toca, no si
    // está contenido en ella: "búscalo entre octubre y diciembre" debe salir
    // cuando el asesor pregunta por noviembre.
    //
    // El `is.null` de cada rama NO es defensivo: es la mitad de la feature.
    // Un `lte("due_from", ...)` contra una fecha nula da NULL, no falso, y una
    // fila con NULL en el WHERE se descarta. Sin esto, preguntar "¿qué tengo
    // pendiente este mes?" borraba en silencio TODOS los compromisos sin fecha
    // —que son la mayoría, porque no tener fecha es justo lo que los hace
    // compromisos— y la skill lo coronaba devolviendo `exhaustive: true`, o
    // sea garantizándole al modelo que ese vacío era de verdad. Caso real
    // (2026-08-28): tres compromisos abiertos y el asistente contestó "no
    // tienes compromisos pendientes".
    //
    // Un pendiente sin fecha cae en cualquier ventana a propósito: no se sabe
    // cuándo toca, y esconderlo hasta que alguien le ponga fecha es perderlo.
    if (filters.to) q = q.or(`due_from.is.null,due_from.lte.${filters.to}`);
    if (filters.from) q = q.or(`due_to.is.null,due_to.gte.${filters.from}`);

    // Busqueda por tema, delegada a search_commitment_ids (migracion
    // 20260903030000). No es un ilike aqui por dos razones: ilike no ignora
    // acentos —"cotizacion" no encuentra "cotización" y falla en silencio— y
    // ademas PostgREST parsea la cadena de or(), asi que una coma o un
    // parentesis en las palabras del asesor romperian el filtro.
    if (filters.query) {
      const { data: ids, error: idsError } = await this.supabase
        .rpc("search_commitment_ids", { p_agent_id: agentId, p_query: filters.query });

      if (idsError) handleSupabaseError(idsError, "commitments search");

      const lista = (ids ?? []) as unknown as string[];
      // Vacio significa "ninguno coincide", no "no filtres".
      if (lista.length === 0) return [];
      q = q.in("id", lista);
    }

    if (filters.overdueOnly) {
      q = q.lt("due_to", new Date().toISOString().slice(0, 10));
    }

    // Sin fecha van al final: son pendientes que envejecen, no citas.
    const { data, error } = await q.order("due_to", { ascending: true, nullsFirst: false });

    if (error) handleSupabaseError(error, "commitments list");

    return (data ?? []).map(toDto);
  }

  /**
   * Solo se escriben los campos presentes: `undefined` significa "no lo toques"
   * y `null` significa "bórralo". La diferencia importa — desligar un cliente es
   * mandar `contactId: null`, no omitirlo.
   *
   * `updated_at` no se toca a mano: lo pone el trigger
   * `tg_client_commitments_updated_at`.
   */
  async update(
    agentId: string,
    id: string,
    changes: CommitmentUpdate,
  ): Promise<CommitmentResponseDTO | null> {
    // Tipado explícito, no `Record<string, unknown>`: el cliente tipado rechaza
    // el genérico, que es exactamente la validación de columnas que queríamos.
    const row: Database["public"]["Tables"]["client_commitments"]["Update"] = {};
    if (changes.contactId !== undefined) row.contact_id = changes.contactId;
    if (changes.label !== undefined) row.label = changes.label;
    if (changes.dueFrom !== undefined) row.due_from = changes.dueFrom;
    if (changes.dueTo !== undefined) row.due_to = changes.dueTo;

    const { data, error } = await this.supabase
      .from("client_commitments")
      .update(row)
      .eq("id", id)
      .eq("agent_id", agentId)
      .eq("is_active", true)
      .select(COMMITMENT_SELECT)
      .maybeSingle();

    if (error) handleSupabaseError(error, "commitment update");
    return data ? toDto(data) : null;
  }

  /**
   * Deshace un cierre. Existe porque cerrar era IRREVERSIBLE: ni el asistente ni
   * la app podían revertirlo, y un compromiso cerrado por error desaparecía de
   * la lista para siempre sin que el asesor se enterara. Con la palomita de la
   * app pasa igual — un toque de más y el pendiente se iba.
   */
  async reopen(agentId: string, id: string): Promise<CommitmentResponseDTO | null> {
    const { data, error } = await this.supabase
      .from("client_commitments")
      // Se limpia tambien resolved_by_session_id: si sobrevive, un compromiso
      // reabierto sigue diciendo "lo cerro la IA" para siempre y ensucia la
      // marca closedByYouInThisConversation en cierres posteriores.
      .update({
        status: "OPEN",
        resolution_note: null,
        resolved_at: null,
        resolved_by_session_id: null,
      })
      .eq("id", id)
      .eq("agent_id", agentId)
      .eq("is_active", true)
      .select(COMMITMENT_SELECT)
      .maybeSingle();

    if (error) handleSupabaseError(error, "commitment reopen");
    return data ? toDto(data) : null;
  }


  /**
   * Cierra SOLO si sigue abierto.
   *
   * El `eq("status","OPEN")` no es defensivo: sin el, cerrar algo ya cerrado
   * pisaba el `resolved_at` y el `resolution_note` originales y devolvia
   * `status: DONE` como si hubiera hecho algo. Observado en produccion por voz
   * el 2026-09-04: el modelo llamo close_commitment DOS VECES con el mismo id,
   * la herramienta le dijo que si las dos, y esa confirmacion falsa le reforzo
   * que iba por buen camino.
   *
   * Devuelve un desenlace y no un `null` ambiguo: "ya estaba cerrado" y "no
   * existe" piden respuestas distintas del asistente, y con null los dos
   * terminaban en "no encontre ese compromiso".
   */
  async close(
    agentId: string,
    id: string,
    status: "DONE" | "DISMISSED",
    resolutionNote?: string,
    // Sesion de IA que lo cierra. `null` = lo cerro el asesor a mano.
    sessionId?: string,
  ): Promise<CommitmentCloseResult> {
    const { data, error } = await this.supabase
      .from("client_commitments")
      .update({
        status,
        resolution_note: resolutionNote ?? null,
        resolved_at: new Date().toISOString(),
        resolved_by_session_id: sessionId ?? null,
      })
      .eq("id", id)
      .eq("agent_id", agentId)
      .eq("status", "OPEN")
      .select(COMMITMENT_SELECT)
      .maybeSingle();

    if (error) handleSupabaseError(error, "commitment close");
    if (data) return { outcome: "closed", commitment: toDto(data) };

    // Sin filas: o no existe, o ya no estaba abierto. La segunda consulta solo
    // corre en el camino de fallo, no en el normal.
    const { data: existente, error: errorLectura } = await this.supabase
      .from("client_commitments")
      .select(COMMITMENT_SELECT)
      .eq("id", id)
      .eq("agent_id", agentId)
      .maybeSingle();

    if (errorLectura) handleSupabaseError(errorLectura, "commitment close lookup");
    if (!existente) return { outcome: "not_found" };
    return { outcome: "already_closed", commitment: toDto(existente) };
  }
}
