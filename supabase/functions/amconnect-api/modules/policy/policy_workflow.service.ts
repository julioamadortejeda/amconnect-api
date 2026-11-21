import type { PolicyRequestDTO, PolicyResponseDTO } from "./policy.dto.ts";
import type { PolicyService } from "./policy.service.ts";
import type { ContactService } from "../contact/contact.service.ts";
import type { CatalogServices } from "../catalog/catalog.service.ts";
import { appendNote, assertNoDuplicatePolicyNumber, hasAnyChange, resolveCatalogId } from "../../shared/utils.ts";

type PolicyDeps = Pick<PolicyService, "create" | "update" | "getById" | "getByField" | "searchPolicies" | "findByFilters">;
type ContactDeps = Pick<ContactService, "findSimilarContact">;
type CatalogDeps = Pick<
  CatalogServices,
  "policyStatusService" | "currencyService" | "paymentFrequencyService" | "paymentMethodService"
>;

/**
 * Nombres amigables de catálogo ("Vigente", "MXN", "Mensual") en vez de ids.
 * Se resuelven contra el catálogo real; un nombre que no existe lanza
 * `ValidationError` con las opciones válidas.
 */
export interface PolicyCatalogNames {
  status?: string;
  currency?: string;
  paymentFrequency?: string;
  paymentMethod?: string;
}

export type CreatePolicyByNamesInput =
  & Omit<Partial<PolicyRequestDTO>, "statusId" | "currencyId" | "paymentFrequencyId" | "paymentMethodId">
  & PolicyCatalogNames;

/** Campos a cambiar en camelCase, con los catálogos por nombre. */
export type UpdatePolicyByNamesInput = Record<string, unknown> & PolicyCatalogNames & { notes?: string };

export type UpdatePolicyResult =
  | { outcome: "no_changes" }
  | { outcome: "updated"; policy: PolicyResponseDTO | null };

export type FindPoliciesByClientResult =
  | { outcome: "no_client" }
  | { outcome: "found"; policies: PolicyResponseDTO[] };

export interface PortfolioStats {
  totalPolicies: number;
  statusBreakdown: Record<string, number>;
  branchBreakdown: Record<string, number>;
  premiumSummaries: Record<string, number>;
}

/**
 * Reglas de negocio de pólizas que cruzan módulos: catálogos por nombre,
 * número de póliza único, notas con fecha, búsqueda por cliente y resumen de
 * cartera.
 */
export class PolicyWorkflowService {
  constructor(
    private policyService: PolicyDeps,
    private contactService: ContactDeps,
    private catalogServices: CatalogDeps,
  ) {}

  /** Crea una póliza; estado y moneda por defecto: ACTIVE y MXN. */
  async createByNames(agentId: string, input: CreatePolicyByNamesInput): Promise<PolicyResponseDTO | null> {
    await assertNoDuplicatePolicyNumber(this.policyService, agentId, input.policyNumber);
    const { status, currency, paymentFrequency, paymentMethod, ...fields } = input;
    const cat = this.catalogServices;
    const statusId = await resolveCatalogId(cat.policyStatusService, status, { key: "code", value: "ACTIVE" });
    const currencyId = await resolveCatalogId(cat.currencyService, currency, { key: "code", value: "MXN" });
    const paymentFrequencyId = paymentFrequency
      ? await resolveCatalogId(cat.paymentFrequencyService, paymentFrequency, { key: "name", value: "Anual" })
      : null;
    const paymentMethodId = paymentMethod
      ? await resolveCatalogId(cat.paymentMethodService, paymentMethod, { key: "name", value: "Tarjeta de Crédito" })
      : null;

    return await this.policyService.create({
      agentId,
      contactId: fields.contactId,
      productId: fields.productId,
      statusId,
      currencyId,
      paymentFrequencyId,
      paymentMethodId,
      policyNumber: fields.policyNumber,
      sumInsured: fields.sumInsured,
      premium: fields.premium,
      startDate: fields.startDate,
      endDate: fields.endDate,
      renewalDate: fields.renewalDate,
      nextPaymentDate: fields.nextPaymentDate,
      notes: fields.notes,
      deductible: fields.deductible,
      coinsurance: fields.coinsurance,
      seniorityDate: fields.seniorityDate,
      insuredItem: fields.insuredItem,
      policyVersion: fields.policyVersion,
    });
  }

  /**
   * Modifica una póliza. Las notas NO se reemplazan: se anexan con fecha a las
   * que ya tenía. Sin un solo campo que cambiar devuelve `no_changes` en vez de
   * escribir nada — una actualización vacía es indistinguible de una exitosa.
   */
  async updateByNames(policyId: string, input: UpdatePolicyByNamesInput): Promise<UpdatePolicyResult> {
    const updates: Record<string, unknown> = { ...input };
    delete updates.status;
    delete updates.currency;
    delete updates.paymentFrequency;
    delete updates.paymentMethod;

    const cat = this.catalogServices;
    if (input.status) {
      updates.statusId = await resolveCatalogId(cat.policyStatusService, input.status, { key: "code", value: "ACTIVE" });
    }
    if (input.currency) {
      updates.currencyId = await resolveCatalogId(cat.currencyService, input.currency, { key: "code", value: "MXN" });
    }
    if (input.paymentFrequency) {
      updates.paymentFrequencyId = await resolveCatalogId(cat.paymentFrequencyService, input.paymentFrequency, {
        key: "name",
        value: "Anual",
      });
    }
    if (input.paymentMethod) {
      updates.paymentMethodId = await resolveCatalogId(cat.paymentMethodService, input.paymentMethod, {
        key: "name",
        value: "Tarjeta de Crédito",
      });
    }

    if (input.notes) {
      const existing = await this.policyService.getById(policyId);
      updates.notes = appendNote(existing?.notes, input.notes);
    }

    if (!hasAnyChange(updates)) return { outcome: "no_changes" };
    const policy = await this.policyService.update(policyId, updates as Partial<PolicyRequestDTO>);
    return { outcome: "updated", policy };
  }

  /**
   * Pólizas de un cliente nombrado por el asesor. Se juntan las de TODOS los
   * contactos parecidos al nombre (no se desambigua): con `policyQuery`, por
   * palabras dentro de cada uno; sin él, todas las suyas.
   */
  async findByClientName(
    agentId: string,
    clientName: string,
    policyQuery?: string,
  ): Promise<FindPoliciesByClientResult> {
    const contacts = await this.contactService.findSimilarContact(agentId, clientName);
    if (!contacts || contacts.length === 0) return { outcome: "no_client" };
    const policies: PolicyResponseDTO[] = [];
    for (const contact of contacts) {
      const found = policyQuery
        ? await this.policyService.searchPolicies(agentId, policyQuery, contact.id)
        : await this.policyService.getByField("contact_id", contact.id);
      if (found) policies.push(...found);
    }
    return { outcome: "found", policies };
  }

  /**
   * Resumen de la cartera: total, conteo por estado y por ramo, y suma de
   * primas por moneda. Sin estado o ramo cuenta como "Unknown"; sin moneda,
   * como MXN.
   */
  async getPortfolioStats(agentId: string): Promise<PortfolioStats> {
    const policies = await this.policyService.getByField("agent_id", agentId);
    const stats: PortfolioStats = {
      totalPolicies: policies?.length ?? 0,
      statusBreakdown: {},
      branchBreakdown: {},
      premiumSummaries: {},
    };
    for (const p of policies ?? []) {
      const statusName = p.status?.name || "Unknown";
      stats.statusBreakdown[statusName] = (stats.statusBreakdown[statusName] || 0) + 1;

      const branchName = p.product?.branch?.name || "Unknown";
      stats.branchBreakdown[branchName] = (stats.branchBreakdown[branchName] || 0) + 1;

      if (p.premium) {
        const currencyCode = p.currency?.code || "MXN";
        stats.premiumSummaries[currencyCode] = (stats.premiumSummaries[currencyCode] || 0) + p.premium;
      }
    }
    return stats;
  }
}
