import { z } from "zod";

export const AgentUpdateSchema = z.object({
  fullName: z.string().min(1).optional(),
  phone: z.string().optional(),
  locale: z.enum(["es", "en"]).optional(),
});

export type AgentUpdateDTO = z.infer<typeof AgentUpdateSchema>;

export const PrivacyConsentSchema = z.object({
  version: z.string().trim().min(1),
  acceptedNotice: z.literal(true),
  acceptedSensitive: z.literal(true),
});
export type PrivacyConsentDTO = z.infer<typeof PrivacyConsentSchema>;

export interface PrivacyStatusDTO {
  acceptedVersion: string | null;
  acceptedAt: string | null;
  currentVersion: string;
  url: string;
  required: boolean;
}
