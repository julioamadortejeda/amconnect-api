import { z } from "zod";

export const ReminderRequestSchema = z.object({
  agentId: z.string().uuid().optional(),
  contactId: z.string().uuid().optional().nullable(),
  policyId: z.string().uuid().optional().nullable(),
  typeId: z.string().uuid(),
  title: z.string().min(1),
  description: z.string().optional().nullable(),
  dueDate: z.string(), // ISO 8601
  statusId: z.string().uuid().optional().nullable(),
  status: z.string().optional().nullable(), // Friendly code like 'PENDING', 'DONE', etc.
  comment: z.string().optional().nullable(),
});

export type ReminderRequestDTO = z.infer<typeof ReminderRequestSchema>;

export interface ReminderCommentDTO {
  id: string;
  reminderId: string;
  agentId: string;
  content: string;
  createdAt: string;
}

// ReminderService convierte la fila completa con objectToCamelCaseDeep, así que
// las notas embebidas también llegan en camelCase.
export interface ReminderNoteDTO {
  id: string;
  content: string | null;
  summary: string | null;
  sourceType: string;
  createdAt: string;
  documentMetadata?: { fileName: string | null; storagePath: string | null } | null;
}

export interface ReminderResponseDTO {
  id: string;
  agentId: string;
  contactId: string | null;
  policyId: string | null;
  typeId: string;
  title: string;
  description: string | null;
  dueDate: string;
  statusId: string;
  comments?: ReminderCommentDTO[];
  notes?: ReminderNoteDTO[];
  notifiedAt: string | null;
  createdAt: string;
  updatedAt: string;
  // Relaciones
  type?: { id: string; name: string; code: string };
  status?: { id: string; name: string; code: string };
  contact?: { id: string; fullName: string } | null;
  policy?: {
    id: string;
    policyNumber: string | null;
    product?: { name: string | null; branch?: { name: string | null; code: string | null } | null } | null;
  } | null;
  /**
   * Recordatorios automáticos (D-023): plantilla del título y datos que no
   * dependen del idioma. `title` ya viene armado con ellos en el idioma del
   * asesor; si el asesor lo edita, la plantilla se borra y queda su texto.
   */
  titleTemplate?: string | null;
  templateData?: { dueDate?: string; amount?: number; currency?: string } | null;
  occurrenceDate?: string | null;
}


