import { z } from "zod";
import { SupabaseClient } from "@supabase/supabase-js";
import { PolicyService } from "../../modules/policy/policy.service.ts";

export const ConfirmPolicySchema = z.object({
  documentMetadataId: z.string().uuid().optional().nullable(),
  // Entidades requeridas (IDs ya resueltos en el frontend o por el AI)
  contactId: z.string().uuid(),
  carrierId: z.string().uuid(),
  branchId: z.string().uuid(),
  productId: z.string().uuid(),
  statusId: z.string().uuid(),
  currencyId: z.string().uuid(),
  // Opcionales
  paymentFrequencyId: z.string().uuid().optional().nullable(),
  paymentMethodId: z.string().uuid().optional().nullable(),
  policyNumber: z.string().optional().nullable(),
  sumInsured: z.number().optional().nullable(),
  premium: z.number().optional().nullable(),
  startDate: z.string().optional().nullable(),
  endDate: z.string().optional().nullable(),
  renewalDate: z.string().optional().nullable(),
  nextPaymentDate: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  beneficiaries: z.array(z.object({
    fullName: z.string(),
    relationship: z.string().optional().nullable(),
    percentage: z.number().optional().nullable(),
  })).optional().default([]),
  participants: z.array(z.object({
    contactId: z.string().uuid().optional().nullable(),
    fullName: z.string().optional().nullable(),
    roleId: z.string().uuid(),
    relationship: z.string().optional().nullable(),
  })).optional().default([]),
});

export type ConfirmPolicyDTO = z.infer<typeof ConfirmPolicySchema>;

export class ConfirmPolicyService {
  constructor(
    private supabase: SupabaseClient,
    private policyService: PolicyService,
  ) {}

  async confirm(agentId: string, data: ConfirmPolicyDTO) {
    // Crear la póliza
    const policy = await this.policyService.create({
      agentId,
      contactId: data.contactId,
      carrierId: data.carrierId,
      branchId: data.branchId,
      productId: data.productId,
      statusId: data.statusId,
      currencyId: data.currencyId,
      paymentFrequencyId: data.paymentFrequencyId ?? null,
      paymentMethodId: data.paymentMethodId ?? null,
      policyNumber: data.policyNumber ?? null,
      sumInsured: data.sumInsured ?? null,
      premium: data.premium ?? null,
      startDate: data.startDate ?? null,
      endDate: data.endDate ?? null,
      renewalDate: data.renewalDate ?? null,
      nextPaymentDate: data.nextPaymentDate ?? null,
      notes: data.notes ?? null,
    });

    if (!policy) throw new Error("No se pudo crear la póliza.");

    // Agregar beneficiarios y participantes en paralelo
    const [beneficiaries, participants] = await Promise.all([
      Promise.all(
        (data.beneficiaries ?? []).map((b) =>
          this.policyService.addBeneficiary({
            policyId: policy.id,
            fullName: b.fullName,
            relationship: b.relationship ?? null,
            percentage: b.percentage ?? null,
          })
        ),
      ),
      Promise.all(
        (data.participants ?? []).map((p) =>
          this.policyService.addParticipant({
            policyId: policy.id,
            contactId: p.contactId ?? null,
            fullName: p.fullName ?? null,
            roleId: p.roleId,
            relationship: p.relationship ?? null,
          })
        ),
      ),
    ]);

    // Vincular el documento si se proporcionó
    if (data.documentMetadataId) {
      await this.supabase
        .from("document_metadata")
        .update({ policy_id: policy.id })
        .eq("id", data.documentMetadataId)
        .eq("agent_id", agentId);
    }

    return { policy, beneficiaries, participants };
  }
}
