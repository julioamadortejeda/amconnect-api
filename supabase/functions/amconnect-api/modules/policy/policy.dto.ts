import { z } from "zod";

export const PolicyRequestSchema = z.object({
  agentId: z.string().uuid().optional(),
  contactId: z.string().uuid(),
  carrierId: z.string().uuid(),
  branchId: z.string().uuid(),
  productId: z.string().uuid(),
  statusId: z.string().uuid(),
  currencyId: z.string().uuid(),
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
});

export type PolicyRequestDTO = z.infer<typeof PolicyRequestSchema>;

export interface PolicyResponseDTO {
  id: string;
  agentId: string;
  contactId: string;
  productId: string;
  statusId: string;
  currencyId: string;
  paymentFrequencyId: string | null;
  paymentMethodId: string | null;
  policyNumber: string | null;
  sumInsured: number | null;
  premium: number | null;
  startDate: string | null;
  endDate: string | null;
  renewalDate: string | null;
  nextPaymentDate: string | null;
  notes: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  // Relaciones expandidas
  contact?: { id: string; fullName: string };
  product?: { id: string; name: string; carrier: { id: string; name: string }; branch: { id: string; name: string } };
  status?: { id: string; name: string };
}

// ─── Participantes ────────────────────────────────────────────────────────────

export const PolicyParticipantSchema = z.object({
  policyId: z.string().uuid(),
  contactId: z.string().uuid().optional().nullable(),
  roleId: z.string().uuid(),
  fullName: z.string().optional().nullable(),
  birthdate: z.string().optional().nullable(),
  relationship: z.string().optional().nullable(),
});
export type PolicyParticipantDTO = z.infer<typeof PolicyParticipantSchema>;

// ─── Beneficiarios ────────────────────────────────────────────────────────────

export const BeneficiarySchema = z.object({
  policyId: z.string().uuid(),
  fullName: z.string().min(1),
  relationship: z.string().optional().nullable(),
  percentage: z.number().min(0).max(100).optional().nullable(),
});
export type BeneficiaryDTO = z.infer<typeof BeneficiarySchema>;
