import { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseRepository } from "../../core/base_repository.ts";
import { PolicyResponseDTO } from "./policy.dto.ts";

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
}
