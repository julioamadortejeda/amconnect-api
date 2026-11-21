// Esquemas Zod de path params y query params de las rutas. El body vive en el
// DTO de cada módulo; aquí solo lo que viaja en la URL.
import { z } from "zod";
import { PaginationQuerySchema } from "../../shared/pagination.ts";

const uuid = z.string().uuid();

/** Una fecha de calendario `YYYY-MM-DD`. */
const calendarDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Se esperaba YYYY-MM-DD");

/** Texto libre de búsqueda: sin espacios sobrantes y vacío = sin filtro. */
const searchText = z.string().transform((s) => s.trim() || undefined);

// ─── Path params ──────────────────────────────────────────────────────────────
export const IdParamSchema = z.object({ id: uuid });
export const ContactIdParamSchema = z.object({ contactId: uuid });
export const SessionIdParamSchema = z.object({ sessionId: uuid });
export const ReminderSettingOverrideParamSchema = z.object({
  typeCode: z.string().min(1).max(64),
  branchId: uuid,
});

// ─── Query params ─────────────────────────────────────────────────────────────
export { PaginationQuerySchema };

export const NotesSearchQuerySchema = PaginationQuerySchema.extend({
  search: searchText.optional(),
});

export const RemindersQuerySchema = PaginationQuerySchema.extend({
  /** Acota al historial de una póliza (incluye los ya cerrados). */
  policyId: uuid.optional(),
  query: searchText.optional(),
});

export const CommitmentsQuerySchema = PaginationQuerySchema.extend({
  from: calendarDate.optional(),
  to: calendarDate.optional(),
  contactId: uuid.optional(),
  overdueOnly: z.enum(["true", "false"]).optional().transform((v) => v === "true"),
  query: searchText.optional(),
});

export const UploadUrlQuerySchema = z.object({
  fileName: z.string().min(1).max(255),
  mimeType: z.string().min(1).max(127).default("application/pdf"),
});
