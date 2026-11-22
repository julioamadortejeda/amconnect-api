import { BaseService } from "../../core/base_service.ts";
import { PolicyRequestDTO, PolicyResponseDTO } from "./policy.dto.ts";
import { PolicyRepository } from "./policy.repository.ts";
import { SupabaseRepository } from "../../core/base_repository.ts";
import { SupabaseClient } from "@supabase/supabase-js";
import { objectToCamelCaseDeep, stripUndefined } from "../../shared/case_converter.ts";
import { EmbeddingsService } from "../../features/rag/embeddings.service.ts";
import { DEFAULT_TIMEZONE, todayInTimezone } from "../../shared/datetime.ts";
import { buildPaymentSchedule } from "../../shared/payment_schedule.ts";
import { type Searchable, type SearchHit, type SearchOptions, toSearchHits } from "../../shared/search_hits.ts";

export class PolicyService extends BaseService<PolicyRequestDTO, PolicyResponseDTO>
  implements Searchable<PolicyResponseDTO> {
  private participantRepo: SupabaseRepository<Record<string, unknown>>;
  private beneficiaryRepo: SupabaseRepository<Record<string, unknown>>;
  private policyRepo: PolicyRepository;

  constructor(
    supabase: SupabaseClient,
    repository: PolicyRepository,
    private readonly timezone: string = DEFAULT_TIMEZONE,
  ) {
    super(repository);
    this.policyRepo = repository;
    this.participantRepo = new SupabaseRepository(supabase, "policy_participants", "*", false);
    this.beneficiaryRepo = new SupabaseRepository(supabase, "beneficiaries", "*", false);
  }

  protected override toDTO(row: unknown): PolicyResponseDTO {
    const dto = objectToCamelCaseDeep(row) as PolicyResponseDTO;

    // El calendario se resuelve aquí, no en el cliente: la app y la futura web
    // consumen el mismo resultado en vez de reimplementar la regla cada una.
    dto.paymentSchedule = buildPaymentSchedule(
      dto.nextPaymentDate,
      dto.paymentFrequency?.months,
      todayInTimezone(this.timezone),
    );

    return dto;
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
      deductible: data.deductible ?? null,
      coinsurance: data.coinsurance ?? null,
      seniority_date: data.seniorityDate ?? null,
      insured_item: data.insuredItem ?? null,
      policy_version: data.policyVersion ?? null,
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
      deductible: data.deductible,
      coinsurance: data.coinsurance,
      seniority_date: data.seniorityDate,
      insured_item: data.insuredItem,
      policy_version: data.policyVersion,
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

  async addNote(
    agentId: string,
    policyId: string,
    content: string,
    embeddingsService: EmbeddingsService,
  ): Promise<{ noteId: string }> {
    // Lanza NotFoundError si la póliza no existe o no es del agente (RLS-scoped).
    await this.getById(policyId);
    return embeddingsService.saveDocument(agentId, {
      content,
      sourceType: "text",
      policyId,
      noteOrigin: "policy",
    });
  }

  /** Pólizas que vencen entre `from` y `to` (YYYY-MM-DD, inclusive), filtradas en la BD. */
  async getExpiringBetween(agentId: string, from: string, to: string): Promise<PolicyResponseDTO[]> {
    const rows = await this.policyRepo.findExpiringBetween(agentId, from, to);
    return rows.map((r) => this.toDTO(r));
  }

  /**
   * Búsqueda por texto libre, tal como lo dijo el asesor ("GMM de AXA", "la
   * del Jetta", "auto de Pedro"). Antes se traían todas las pólizas y se
   * filtraba en memoria con la frase completa; ahora decide `search_policy_ids`
   * (migración 20261121002454): todas las palabras, sin acentos, sinónimos de
   * ramo y aseguradora, y tolerancia a typos.
   */
  async searchPolicies(agentId: string, queryText: string, contactId?: string): Promise<PolicyResponseDTO[] | null> {
    const ids = await this.policyRepo.searchIds(agentId, queryText ?? "", contactId);
    const rows = await this.policyRepo.getByIds(ids);
    return rows.map((r) => this.toDTO(r));
  }

  /**
   * Fuente "policy" de `recall` (ver shared/search_hits.ts). Mismo
   * `search_policy_ids` que la skill `search_policies`; el `rank` es su orden
   * de relevancia (la función no expone el puntaje).
   */
  async searchHits(agentId: string, query: string, opts: SearchOptions = {}): Promise<SearchHit<PolicyResponseDTO>[]> {
    const items = await this.searchPolicies(agentId, query, opts.contactId);
    return toSearchHits("policy", items ?? [], (p) => p.id, { limit: opts.limit });
  }

}
