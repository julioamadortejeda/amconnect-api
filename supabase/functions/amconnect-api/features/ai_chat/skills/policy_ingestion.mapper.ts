// Lo que el MODELO (y la tarjeta del chat) ven al cerrar una ingesta de póliza.
// Solo forma: las reglas viven en PolicyConfirmationService.
import type {
  ApplyPolicyUpdateResult,
  ConfirmPolicyResult,
} from "../../document_processing/policy_confirmation.service.ts";

export function policyConfirmedResult(result: ConfirmPolicyResult) {
  if (result.outcome === "missing_required") {
    return { error: "Missing required data: carrier_name, branch_name, and holder_name are required." };
  }
  return {
    success: true,
    policyId: result.policy.id,
    policyNumber: result.policy.policyNumber,
    message: "Policy created successfully.",
    __skillMetadata: {
      type: "policy_confirmed",
      policyId: result.policy.id,
      policyNumber: result.policy.policyNumber,
      carrierName: result.carrierName,
      branchName: result.branchName,
      holderName: result.holderName,
      fieldCount: result.fieldCount,
      reminders: result.reminders,
    },
  };
}

export function policyUpdatedResult(result: ApplyPolicyUpdateResult) {
  if (result.outcome === "no_session_data") {
    return { error: "No update data found in session. Please start a new ingestion." };
  }
  if (result.outcome === "missing_carrier_or_branch") {
    return { error: "Missing carrier or branch in extraction data." };
  }
  return {
    success: true,
    policyId: result.policyId,
    policyNumber: result.policyNumber,
    message: "Policy updated successfully.",
    changesApplied: result.changesApplied,
    __skillMetadata: {
      type: "policy_updated",
      policyId: result.policyId,
      policyNumber: result.policyNumber,
      carrierName: result.carrierName,
      branchName: result.branchName,
      holderName: result.holderName,
      fieldCount: result.changesApplied,
      changesApplied: result.changesApplied,
      remainingDifferences: result.remainingDifferences,
    },
  };
}
