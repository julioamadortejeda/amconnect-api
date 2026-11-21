import { SupabaseClient } from "@supabase/supabase-js";
import { BaseService } from "../../core/base_service.ts";
import { SupabaseRepository } from "../../core/base_repository.ts";
import { handleSupabaseError } from "../../shared/errors.ts";
import { objectToCamelCaseDeep, objectToSnakeCase, toTitleCase } from "../../shared/case_converter.ts";

// ─── Catálogo global — solo lectura ──────────────────────────────────────────

function makeGlobalCatalogService(supabase: SupabaseClient, tableName: string) {
  const repo = new SupabaseRepository<Record<string, unknown>>(supabase, tableName);
  return new (class extends BaseService<Record<string, unknown>> {
    protected override toDTO(row: unknown): Record<string, unknown> {
      return objectToCamelCaseDeep(row) as Record<string, unknown>;
    }

    async getByCode(code: string) {
      const rows = await this.repository.findByFilters({ code }, 1);
      return rows?.[0] ? this.toDTO(rows[0]) : null;
    }
  })(repo);
}

// ─── Catálogo por agente — CRUD completo ─────────────────────────────────────

function makeAgentCatalogService(supabase: SupabaseClient, tableName: string, agentId: string) {
  const repo = new SupabaseRepository<Record<string, unknown>>(supabase, tableName);
  return new (class extends BaseService<Record<string, unknown>> {
    protected override toDTO(row: unknown): Record<string, unknown> {
      return objectToCamelCaseDeep(row) as Record<string, unknown>;
    }

    protected override prepareForCreate(data: Partial<Record<string, unknown>>): Record<string, unknown> {
      const payload = { ...data };
      if (typeof payload.name === "string") {
        payload.name = toTitleCase(payload.name);
      }
      return { ...objectToSnakeCase(payload as Record<string, unknown>), agent_id: agentId };
    }

    protected override prepareForUpdate(_id: string, data: Partial<Record<string, unknown>>): Record<string, unknown> {
      const payload = { ...data };
      if (typeof payload.name === "string") {
        payload.name = toTitleCase(payload.name);
      }
      return objectToSnakeCase(payload as Record<string, unknown>);
    }

    override async search(query: string, _threshold?: number): Promise<Record<string, unknown>[] | null> {
      const { data, error } = await supabase
        .from(tableName)
        .select("id, name")
        .eq("agent_id", agentId)
        .eq("is_active", true)
        .ilike("name", `%${query}%`)
        .order("name")
        .limit(10);
      // Lanzar: un fallo no es "ese catálogo no tiene coincidencias".
      if (error) handleSupabaseError(error, `catalog.search ${tableName}`);
      return (data ?? []).map((r) => this.toDTO(r));
    }
  })(repo);
}

export function createCatalogServices(supabase: SupabaseClient, agentId: string) {
  const productService = Object.assign(
    makeAgentCatalogService(supabase, "products", agentId),
    {
      /**
       * Productos con ese nombre DE esa aseguradora (y de ese ramo, si se
       * conoce). El producto es por asesor y cuelga de carrier+branch: buscar
       * solo por nombre reutilizaba el producto de otra aseguradora.
       */
      async findByNameInCarrier(
        name: string,
        carrierId: string,
        branchId?: string | null,
      ): Promise<Record<string, unknown>[]> {
        let query = supabase
          .from("products")
          .select("id, name, carrier_id, branch_id")
          .eq("agent_id", agentId)
          .eq("is_active", true)
          .eq("carrier_id", carrierId)
          .ilike("name", `%${name}%`);
        if (branchId) query = query.eq("branch_id", branchId);
        const { data, error } = await query.order("name").limit(10);
        if (error) handleSupabaseError(error, "catalog.findProductByNameInCarrier");
        return (data ?? []).map((r) => objectToCamelCaseDeep(r) as Record<string, unknown>);
      },

      async getWithRelations() {
        const { data, error } = await supabase
          .from("products")
          .select("id, name, carrier:carriers(id, name), branch:branches(id, name)")
          .eq("agent_id", agentId)
          .eq("is_active", true)
          .order("name");
        if (error) handleSupabaseError(error, "catalog.getProductsWithRelations");
        return data ?? [];
      },
    },
  );

  return {
    // Por agente — CRUD completo
    carrierService: makeAgentCatalogService(supabase, "carriers", agentId),
    branchService: makeAgentCatalogService(supabase, "branches", agentId),
    productService,
    // Globales — solo lectura
    currencyService: makeGlobalCatalogService(supabase, "currencies"),
    paymentFrequencyService: makeGlobalCatalogService(supabase, "payment_frequencies"),
    paymentMethodService: makeGlobalCatalogService(supabase, "payment_methods"),
    policyStatusService: makeGlobalCatalogService(supabase, "policy_statuses"),
    participantRoleService: makeGlobalCatalogService(supabase, "participant_roles"),
    reminderTypeService: makeGlobalCatalogService(supabase, "reminder_types"),
    reminderStatusService: makeGlobalCatalogService(supabase, "reminder_statuses"),
  };
}

export type CatalogServices = ReturnType<typeof createCatalogServices>;
