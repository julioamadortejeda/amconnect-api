import { z } from "zod";

export const ContactRequestSchema = z.object({
  agentId: z.string().uuid().optional(),
  fullName: z.string().min(1),
  email: z.string().email().optional().nullable(),
  phone: z.string().optional().nullable(),
  birthdate: z.string().optional().nullable(),
  rfc: z.string().optional().nullable(),
  curp: z.string().optional().nullable(),
  address: z.string().optional().nullable(),
  occupation: z.string().optional().nullable(),
  notes: z.string().optional().nullable(),
  referredById: z.string().uuid().optional().nullable(),
  externalReferrerSource: z.string().optional().nullable(),
  isProspect: z.boolean().optional(),
});

export type ContactRequestDTO = z.infer<typeof ContactRequestSchema>;

export interface ContactResponseDTO {
  id: string;
  agentId: string;
  fullName: string;
  email: string | null;
  phone: string | null;
  birthdate: string | null;
  rfc: string | null;
  curp: string | null;
  address: string | null;
  occupation: string | null;
  notes: string | null;
  referredById: string | null;
  externalReferrerSource: string | null;
  isProspect: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}
