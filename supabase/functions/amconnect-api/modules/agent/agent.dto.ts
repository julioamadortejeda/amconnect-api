import { z } from "zod";

export const AgentUpdateSchema = z.object({
  fullName: z.string().min(1).optional(),
  phone: z.string().optional(),
});

export type AgentUpdateDTO = z.infer<typeof AgentUpdateSchema>;

export const AgentResponseSchema = z.object({
  id: z.string().uuid(),
  fullName: z.string(),
  email: z.string(),
  phone: z.string().nullable(),
  plan: z.enum(["free", "pro"]),
  isActive: z.boolean(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export type AgentResponseDTO = z.infer<typeof AgentResponseSchema>;
