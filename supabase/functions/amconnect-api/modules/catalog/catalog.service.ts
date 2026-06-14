import { SupabaseClient } from "@supabase/supabase-js";
import { BaseService } from "../../core/base_service.ts";
import { SupabaseRepository } from "../../core/base_repository.ts";
import { objectToCamelCaseDeep, objectToSnakeCase } from "../../shared/case_converter.ts";

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
      return { ...objectToSnakeCase(data as Record<string, unknown>), agent_id: agentId };
    }

    protected override prepareForUpdate(_id: string, data: Partial<Record<string, unknown>>): Record<string, unknown> {
      return objectToSnakeCase(data as Record<string, unknown>);
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
      if (error) console.error(`[catalog.search] ${tableName}:`, error.message);
      return data ? data.map((r) => this.toDTO(r)) : [];
    }
  })(repo);
}

export function createCatalogServices(supabase: SupabaseClient, agentId: string) {
  const productService = Object.assign(
    makeAgentCatalogService(supabase, "products", agentId),
    {
      async getWithRelations() {
        const { data, error } = await supabase
          .from("products")
          .select("id, name, carrier:carriers!carrier_id(id, name), branch:branches!branch_id(id, name)")
          .eq("agent_id", agentId)
          .eq("is_active", true)
          .order("name");
        if (error) console.error("[catalog.getProductsWithRelations]:", error.message);
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
