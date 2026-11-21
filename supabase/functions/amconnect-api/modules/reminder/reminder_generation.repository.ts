import { SupabaseClient } from "@supabase/supabase-js";
import { internalError } from "../../shared/errors.ts";
import type { ReminderTemplateData, ReminderTitleTemplate } from "./reminder_title.renderer.ts";

export interface ReminderTypeRow {
  id: string;
  code: string;
  name: string;
}

/**
 * What a generated reminder hangs from: a policy (and its holder), or only a
 * contact for birthdays. The holder is stored too so the reminder shows and
 * searches by the client's name and appears in that client's agenda.
 */
export interface ReminderOwner {
  policyId?: string | null;
  contactId?: string | null;
}

export interface CreateReminderData {
  agentId: string;
  owner: ReminderOwner;
  typeId: string;
  /** Respaldo ya armado en el idioma del asesor, para clientes viejos. */
  title: string;
  /** Plantilla con la que se arma el título al leerlo (D-023). */
  titleTemplate: ReminderTitleTemplate;
  templateData: ReminderTemplateData;
  dueDate: string;
  /** Ocurrencia del calendario que cubre; no cambia si se reagenda. */
  occurrenceDate: string;
  /** Solo cuando la fecha se dedujo en vez de leerse de la carátula. */
  description?: string;
}

/** Catálogos que el generador necesita; se cargan una vez por instancia. */
export interface GenerationCatalog {
  createdStatusId: string;
  types: ReminderTypeRow[];
}

/** Lo que pasó con cada recordatorio pedido a `insertGenerated`. */
export interface InsertedReminderRow {
  id: string;
  typeId: string;
  occurrenceDate: string;
  title: string;
  dueDate: string;
  isActive: boolean;
  /** false = su ocurrencia ya existía (en cualquier estado, incluso borrada). */
  isNew: boolean;
}

/**
 * The bits of a policy the schedule depends on, resolved from its product,
 * plus what the fallback title and `template_data` need.
 */
export interface PolicyScheduleInfo {
  branchId: string | null;
  frequencyMonths: number | null;
  contactId: string | null;
  clientName: string | null;
  productName: string | null;
  branchName: string | null;
  branchCode: string | null;
  premium: number | null;
  currencyCode: string | null;
}

export interface IReminderGenerationRepository {
  findCatalog(typeCodes: readonly string[]): Promise<GenerationCatalog>;
  findPolicyScheduleInfo(policyId: string): Promise<PolicyScheduleInfo | null>;
  insertGenerated(rows: CreateReminderData[], createdStatusId: string): Promise<InsertedReminderRow[]>;
}

export class ReminderGenerationRepository implements IReminderGenerationRepository {
  constructor(private supabase: SupabaseClient) {}

  async findCatalog(typeCodes: readonly string[]): Promise<GenerationCatalog> {
    const [statusRes, typesRes] = await Promise.all([
      this.supabase.from("reminder_statuses").select("id").eq("code", "CREATED").maybeSingle(),
      this.supabase.from("reminder_types").select("id, code, name").in("code", typeCodes as string[]).eq("is_active", true),
    ]);

    // Antes se ignoraba el `error`: una falla transitoria parecía "no hay
    // catálogo" y el job seguía como si nada.
    if (statusRes.error || !statusRes.data) {
      throw internalError(
        "No se pudieron cargar los estados de recordatorio.",
        `reminder_statuses CREATED load failed: ${statusRes.error?.message ?? "not found"}`,
      );
    }
    if (typesRes.error) {
      throw internalError("No se pudieron cargar los tipos de recordatorio.", `reminder_types load failed: ${typesRes.error.message}`);
    }

    return {
      createdStatusId: (statusRes.data as { id: string }).id,
      types: (typesRes.data ?? []) as ReminderTypeRow[],
    };
  }

  async findPolicyScheduleInfo(policyId: string): Promise<PolicyScheduleInfo | null> {
    const { data, error } = await this.supabase
      .from("policies")
      .select(
        "contact_id, premium, product:products(name, branch_id, branch:branches(name, code)), " +
          "frequency:payment_frequencies!payment_frequency_id(months), " +
          "contact:contacts(full_name), currency:currencies(code)",
      )
      .eq("id", policyId)
      .maybeSingle();

    if (error) throw internalError("No se pudo leer la póliza.", `policy schedule info failed for ${policyId}: ${error.message}`);
    if (!data) return null;
    const row = data as {
      contact_id?: string | null;
      premium?: number | string | null;
      product?: { name?: string | null; branch_id?: string | null; branch?: { name?: string | null; code?: string | null } | null } | null;
      frequency?: { months?: number | null } | null;
      contact?: { full_name?: string | null } | null;
      currency?: { code?: string | null } | null;
    };
    return {
      branchId: row.product?.branch_id ?? null,
      frequencyMonths: row.frequency?.months ?? null,
      contactId: row.contact_id ?? null,
      clientName: row.contact?.full_name ?? null,
      productName: row.product?.name ?? null,
      branchName: row.product?.branch?.name ?? null,
      branchCode: row.product?.branch?.code ?? null,
      premium: row.premium === null || row.premium === undefined ? null : Number(row.premium),
      currencyCode: row.currency?.code ?? null,
    };
  }

  /**
   * Inserta los recordatorios de una vez con `on conflict do nothing` contra el
   * índice único de ocurrencia (`insert_generated_reminders`). Reemplaza el
   * "busca y luego inserta" por candidato: además de ser N+1, una búsqueda
   * fallida devolvía null y se creaba un duplicado. Ahora lo impide la BD,
   * también entre dos corridas simultáneas, y una ocurrencia que el asesor
   * borró sigue contando como tomada.
   */
  async insertGenerated(rows: CreateReminderData[], createdStatusId: string): Promise<InsertedReminderRow[]> {
    if (rows.length === 0) return [];
    const payload = rows.map((r) => ({
      agent_id: r.agentId,
      policy_id: r.owner.policyId ?? null,
      contact_id: r.owner.contactId ?? null,
      type_id: r.typeId,
      title: r.title,
      title_template: r.titleTemplate,
      template_data: r.templateData,
      description: r.description ?? null,
      due_date: r.dueDate,
      occurrence_date: r.occurrenceDate,
      status_id: createdStatusId,
    }));

    const { data, error } = await this.supabase.rpc("insert_generated_reminders", { p_rows: payload });
    if (error) throw internalError("No se pudieron generar los recordatorios.", `insert_generated_reminders failed: ${error.message}`);

    return ((data ?? []) as Array<Record<string, unknown>>).map((r) => ({
      id: r.id as string,
      typeId: r.type_id as string,
      occurrenceDate: r.occurrence_date as string,
      title: r.title as string,
      dueDate: r.due_date as string,
      isActive: r.is_active as boolean,
      isNew: r.is_new as boolean,
    }));
  }
}
