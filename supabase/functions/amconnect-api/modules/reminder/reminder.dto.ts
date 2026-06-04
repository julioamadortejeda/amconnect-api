import { z } from "zod";

export const ReminderRequestSchema = z.object({
  agentId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional().nullable(),
  policyId: z.string().uuid().optional().nullable(),
  typeId: z.string().uuid(),
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  dueDate: z.string(), // ISO 8601
  isDone: z.boolean().optional().default(false),
});

export type ReminderRequestDTO = z.infer<typeof ReminderRequestSchema>;

export interface ReminderResponseDTO {
  id: string;
  agentId: string;
  contactId: string | null;
  policyId: string | null;
  typeId: string;
  title: string;
  description: string | null;
  dueDate: string;
  isDone: boolean;
  notifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
  // Relaciones
  type?: { id: string; name: string; code: string };
  contact?: { id: string; fullName: string };
  policy?: { id: string; policyNumber: string | null };
}
