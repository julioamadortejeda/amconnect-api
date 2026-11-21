// Lo que el MODELO (y la tarjeta del chat) ven de una póliza. Solo forma: las
// reglas de negocio viven en PolicyWorkflowService.
import type { PolicyResponseDTO } from "../../../modules/policy/policy.dto.ts";
import type { PortfolioStats } from "../../../modules/policy/policy_workflow.service.ts";

export const slimPolicy = (p: PolicyResponseDTO) => ({
  id: p.id,
  policyNumber: p.policyNumber,
  contact: p.contact,
  premium: p.premium,
  sumInsured: p.sumInsured,
  startDate: p.startDate,
  endDate: p.endDate,
  renewalDate: p.renewalDate,
  nextPaymentDate: p.nextPaymentDate,
  notes: p.notes,
  deductible: p.deductible,
  coinsurance: p.coinsurance,
  seniorityDate: p.seniorityDate,
  insuredItem: p.insuredItem,
  policyVersion: p.policyVersion,
  product: p.product,
  status: p.status,
});

// Tarjeta de pólizas del chat (metadata `policy_list`).
export const policyCardItem = (p: PolicyResponseDTO) => ({
  id: p.id,
  policyNumber: p.policyNumber,
  holderName: p.contact?.fullName ?? "",
  carrierName: p.product?.carrier?.name ?? "",
  branchName: p.product?.branch?.name ?? "",
  productName: p.product?.name ?? "",
  statusName: p.status?.name ?? "",
  premium: p.premium,
  sumInsured: p.sumInsured,
  renewalDate: p.renewalDate,
  nextPaymentDate: p.nextPaymentDate,
});

/** Lista de pólizas para el modelo + la tarjeta `policy_list`. */
export function policyListResult(policies: PolicyResponseDTO[] | null) {
  return {
    policies: (policies ?? []).map(slimPolicy),
    __skillMetadata: {
      type: "policy_list",
      policies: (policies ?? []).map(policyCardItem),
    },
  };
}

/** Detalle de una póliza + la tarjeta `policy_info`. */
export function policyDetailResult(
  policy: PolicyResponseDTO | null,
  participants: unknown,
  beneficiaries: unknown,
) {
  if (!policy) return { policy: null, participants: [], beneficiaries: [] };
  // deno-lint-ignore no-explicit-any
  const policyAny = policy as any;
  return {
    policy,
    participants,
    beneficiaries,
    __skillMetadata: {
      type: "policy_info",
      policyId: policy.id,
      policyNumber: policy.policyNumber,
      carrierName: policyAny.product?.carrier?.name ?? "",
      branchName: policyAny.product?.branch?.name ?? "",
      productName: policyAny.product?.name ?? "",
      holderName: policy.contact?.fullName ?? "",
      premium: policy.premium,
      sumInsured: policy.sumInsured,
      startDate: policy.startDate,
      endDate: policy.endDate,
      renewalDate: policy.renewalDate,
      nextPaymentDate: policy.nextPaymentDate,
      statusName: policyAny.status?.name ?? "",
      deductible: policy.deductible,
      coinsurance: policy.coinsurance,
      seniorityDate: policy.seniorityDate,
      insuredItem: policy.insuredItem,
      policyVersion: policy.policyVersion,
    },
  };
}

export function portfolioStatsResult(stats: PortfolioStats) {
  if (stats.totalPolicies === 0) {
    return { totalPolicies: 0, message: "You have no policies in your portfolio." };
  }
  return {
    totalPolicies: stats.totalPolicies,
    statusBreakdown: stats.statusBreakdown,
    branchBreakdown: stats.branchBreakdown,
    premiumSummaries: stats.premiumSummaries,
  };
}
