import { z } from "zod";
import type { PaymentSchedule } from "../../shared/payment_schedule.ts";

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
  deductible: z.string().optional().nullable(),
  coinsurance: z.string().optional().nullable(),
  seniorityDate: z.string().optional().nullable(),
  insuredItem: z.string().optional().nullable(),
  policyVersion: z.string().optional().nullable(),
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
  deductible: string | null;
  coinsurance: string | null;
  seniorityDate: string | null;
  insuredItem: string | null;
  policyVersion: string | null;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  // Relaciones expandidas
  contact?: { id: string; fullName: string };
  product?: { id: string; name: string; carrier: { id: string; name: string }; branch: { id: string; name: string } };
  status?: { id: string; name: string };
  currency?: { id: string; code: string; name: string };
  paymentFrequency?: { id: string; name: string; months: number };
  paymentMethod?: { id: string; name: string };
  /**
   * Calendario de pago ya resuelto en el servidor: la regla atemporal
   * ("paga el 10 de may y el 10 de nov") más la siguiente fecha real.
   * Los clientes solo lo pintan — ni la app ni la web recalculan fechas.
   */
  paymentSchedule?: PaymentSchedule | null;
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

// ─── Notas manuales ───────────────────────────────────────────────────────────

export const PolicyNoteCreateSchema = z.object({
  content: z.string().min(1, "El campo 'content' es requerido."),
});
export type PolicyNoteCreateDTO = z.infer<typeof PolicyNoteCreateSchema>;

// ─── Beneficiarios ────────────────────────────────────────────────────────────

export const BeneficiarySchema = z.object({
  policyId: z.string().uuid(),
  fullName: z.string().min(1),
  relationship: z.string().optional().nullable(),
  percentage: z.number().min(0).max(100).optional().nullable(),
});
export type BeneficiaryDTO = z.infer<typeof BeneficiarySchema>;
