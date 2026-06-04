import { SupabaseClient } from "@supabase/supabase-js";
import { SupabaseRepository } from "../../core/base_repository.ts";
import { PolicyResponseDTO } from "./policy.dto.ts";

const POLICY_SELECT = `
  *,
  contact:contacts(id, full_name),
  product:products(id, name, carrier:carriers(id, name), branch:branches(id, name)),
  status:policy_statuses(id, name),
  currency:currencies(id, code, name),
  payment_frequency:payment_frequencies(id, name, months),
  payment_method:payment_methods(id, name)
`.trim();

export class PolicyRepository extends SupabaseRepository<PolicyResponseDTO> {
  constructor(supabase: SupabaseClient) {
    super(supabase, "policies", POLICY_SELECT);
  }
}
