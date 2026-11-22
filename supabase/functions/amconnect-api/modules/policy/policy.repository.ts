import { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseRepository } from "../../core/base_repository.ts";
import { PolicyResponseDTO } from "./policy.dto.ts";
import { handleSupabaseError } from "../../shared/errors.ts";

// Los catálogos globales viajan con su `code`: la app y la web traducen por él
// (CatalogL10n). El `name` en inglés no sirve de clave — "Direct Debit" no es
// `DIRECT_DEBIT`.
const POLICY_SELECT = `
  *,
  contact:contacts(id, full_name),
  product:products(id, name, carrier:carriers(id, name), branch:branches(id, name)),
  status:policy_statuses(id, code, name),
  currency:currencies(id, code, name),
  payment_frequency:payment_frequencies(id, code, name, months),
  payment_method:payment_methods(id, code, name)
`.trim();

export class PolicyRepository extends SupabaseRepository<PolicyResponseDTO> {
  constructor(supabase: SupabaseClient) {
    super(supabase, "policies", POLICY_SELECT);
  }

  /**
   * Ids de las pólizas que coinciden con lo que dijo el asesor, en orden de
   * relevancia. La función SQL decide QUÉ filas (palabras, acentos, sinónimos,
   * typos); el select con joins se queda aquí (`getByIds`).
   */
  async searchIds(agentId: string, queryText: string, contactId?: string): Promise<string[]> {
    const { data, error } = await this.supabase.rpc("search_policy_ids", {
      p_agent_id: agentId,
      p_query: queryText,
      p_contact_id: contactId ?? null,
    });

    // NO devolver [] al fallar: el modelo lo leería como "no tiene esa póliza".
    if (error) handleSupabaseError(error, "policy.searchIds");

    return (data ?? []) as unknown as string[];
  }

  /** Filas completas para los ids dados, en el MISMO orden en que llegaron. */
  async getByIds(ids: string[]): Promise<PolicyResponseDTO[]> {
    if (ids.length === 0) return [];

    const { data, error } = await this.table
      .select(this.selectString)
      .in("id", ids)
      .eq("is_active", true);

    if (error) handleSupabaseError(error, "policy.getByIds");

    // `.in()` no respeta el orden de la lista: se reordena por relevancia.
    const position = new Map(ids.map((id, i) => [id, i]));
    return ((data ?? []) as PolicyResponseDTO[])
      .sort((a, b) => (position.get(a.id) ?? 0) - (position.get(b.id) ?? 0));
  }

  /**
   * Pólizas activas del asesor cuyo `end_date` cae en [from, to] (YYYY-MM-DD,
   * ambos inclusive), de la que vence primero a la última. El filtro vive en
   * SQL: antes se traían las 100 más recientes y se filtraba en memoria, así
   * que un rango lejano dejaba fuera pólizas.
   */
  async findExpiringBetween(agentId: string, from: string, to: string, limit = 200): Promise<PolicyResponseDTO[]> {
    const { data, error } = await this.table
      .select(this.selectString)
      .eq("agent_id", agentId)
      .eq("is_active", true)
      .gte("end_date", from)
      .lte("end_date", to)
      .order("end_date", { ascending: true })
      .limit(limit);

    if (error) handleSupabaseError(error, "policy.findExpiringBetween");
    return (data ?? []) as PolicyResponseDTO[];
  }
}
