import { z } from "zod";

export const AgentUpdateSchema = z.object({
  fullName: z.string().min(1).optional(),
  phone: z.string().optional(),
});

export type AgentUpdateDTO = z.infer<typeof AgentUpdateSchema>;
