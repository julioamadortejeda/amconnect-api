import { BaseService } from "../../core/base_service.ts";
import { PolicyRequestDTO, PolicyResponseDTO } from "./policy.dto.ts";
import { PolicyRepository } from "./policy.repository.ts";
import { SupabaseRepository } from "../../core/base_repository.ts";
import { SupabaseClient } from "@supabase/supabase-js";
import { objectToCamelCaseDeep, stripUndefined } from "../../shared/case_converter.ts";

export class PolicyService extends BaseService<PolicyRequestDTO, PolicyResponseDTO> {
  private participantRepo: SupabaseRepository<Record<string, unknown>>;
  private beneficiaryRepo: SupabaseRepository<Record<string, unknown>>;

  constructor(supabase: SupabaseClient, repository: PolicyRepository) {
    super(repository);
    this.participantRepo = new SupabaseRepository(supabase, "policy_participants", "*", false);
    this.beneficiaryRepo = new SupabaseRepository(supabase, "beneficiaries", "*", false);
  }

  protected override toDTO(row: unknown): PolicyResponseDTO {
    return objectToCamelCaseDeep(row) as PolicyResponseDTO;
  }

  protected override prepareForCreate(data: Partial<PolicyRequestDTO>): Record<string, unknown> {
    return {
      agent_id: data.agentId,
      contact_id: data.contactId,
      product_id: data.productId,
      status_id: data.statusId,
      currency_id: data.currencyId,
      payment_frequency_id: data.paymentFrequencyId ?? null,
      payment_method_id: data.paymentMethodId ?? null,
      policy_number: data.policyNumber ?? null,
      sum_insured: data.sumInsured ?? null,
      premium: data.premium ?? null,
      start_date: data.startDate ?? null,
      end_date: data.endDate ?? null,
      renewal_date: data.renewalDate ?? null,
      next_payment_date: data.nextPaymentDate ?? null,
      notes: data.notes ?? null,
    };
  }

  protected override prepareForUpdate(_id: string, data: Partial<PolicyRequestDTO>): Record<string, unknown> {
    return stripUndefined({
      contact_id: data.contactId,
      product_id: data.productId,
      status_id: data.statusId,
      currency_id: data.currencyId,
      payment_frequency_id: data.paymentFrequencyId,
      payment_method_id: data.paymentMethodId,
      policy_number: data.policyNumber,
      sum_insured: data.sumInsured,
      premium: data.premium,
      start_date: data.startDate,
      end_date: data.endDate,
      renewal_date: data.renewalDate,
      next_payment_date: data.nextPaymentDate,
      notes: data.notes,
    });
  }

  async addParticipant(data: Record<string, unknown>) {
    const row = await this.participantRepo.create({
      policy_id: data.policyId,
      contact_id: data.contactId ?? null,
      role_id: data.roleId,
      full_name: data.fullName ?? null,
      birthdate: data.birthdate ?? null,
      relationship: data.relationship ?? null,
    });
    return row ? objectToCamelCaseDeep(row) : null;
  }

  async addBeneficiary(data: Record<string, unknown>) {
    const row = await this.beneficiaryRepo.create({
      policy_id: data.policyId,
      full_name: data.fullName,
      relationship: data.relationship ?? null,
      percentage: data.percentage ?? null,
    });
    return row ? objectToCamelCaseDeep(row) : null;
  }

  async getParticipants(policyId: string) {
    const rows = await this.participantRepo.getByField("policy_id", policyId);
    return rows ? rows.map((r) => objectToCamelCaseDeep(r)) : null;
  }

  async getBeneficiaries(policyId: string) {
    const rows = await this.beneficiaryRepo.getByField("policy_id", policyId);
    return rows ? rows.map((r) => objectToCamelCaseDeep(r)) : null;
  }

  async getUpcomingExpirations(agentId: string, days = 30): Promise<PolicyResponseDTO[] | null> {
    const items = await this.getByField("agent_id", agentId);
    if (!items) return null;
    const now = new Date();
    const limitDate = new Date(Date.now() + days * 86400000);
    return items.filter((p) => {
      if (!p.endDate) return false;
      const d = new Date(p.endDate);
      return d >= now && d <= limitDate;
    });
  }

  async searchPolicies(agentId: string, queryText: string, contactId?: string): Promise<PolicyResponseDTO[] | null> {
    const items = await this.getByField("agent_id", agentId);
    if (!items) return null;
    
    let filtered = items.map((r) => this.toDTO(r));
    if (contactId) {
      filtered = filtered.filter((p) => p.contactId === contactId);
    }
    
    if (queryText) {
      const q = queryText.toLowerCase().trim();
      filtered = filtered.filter((p) => {
        const policyNo = String(p.policyNumber || "").toLowerCase();
        const productName = String(p.product?.name || "").toLowerCase();
        const branchName = String(p.product?.branch?.name || "").toLowerCase();
        const carrierName = String(p.product?.carrier?.name || "").toLowerCase();
        const clientName = String(p.contact?.fullName || "").toLowerCase();
        const notes = String(p.notes || "").toLowerCase();
        
        return policyNo.includes(q) || 
               productName.includes(q) || 
               branchName.includes(q) || 
               carrierName.includes(q) || 
               clientName.includes(q) ||
               notes.includes(q);
      });
    }
    return filtered;
  }
}
