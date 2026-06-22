import { z } from "zod";

export const VALID_CONTEXT_TYPES = ["contact", "policy", "reminder"] as const;

export const AiChatContextSchema = z.object({
  type: z.enum(VALID_CONTEXT_TYPES, {
    errorMap: () => ({ message: "Field 'type' must be one of: contact | policy | reminder" }),
  }),
  id: z.string().uuid().optional().nullable(),
  data: z.record(z.unknown()),
});

export type AiChatContext = z.infer<typeof AiChatContextSchema>;

export const AiChatSchema = z.object({
  message: z.string().min(1, "Field 'message' is required."),
  sessionId: z.string().uuid().optional().nullable(),
  context: AiChatContextSchema.optional().nullable(),
});

export type AiChatDTO = z.infer<typeof AiChatSchema>;

export const AiIngestPolicySchema = z.object({
  storagePath: z.string().min(1, "El campo 'storagePath' es requerido."),
  fileName: z.string().min(1, "El campo 'fileName' es requerido."),
  mimeType: z.string().refine(
    (m) => m === "application/pdf" || m.startsWith("image/"),
    { message: "ingest-policy solo acepta PDF o imágenes (image/*)." },
  ),
  contactId: z.string().uuid().optional().nullable(),
});

export type AiIngestPolicyDTO = z.infer<typeof AiIngestPolicySchema>;

export const AiIngestFileSchema = z.object({
  storagePath: z.string().min(1, "El campo 'storagePath' es requerido."),
  fileName: z.string().min(1, "El campo 'fileName' es requerido."),
  mimeType: z.string().min(1, "El campo 'mimeType' es requerido."),
  contactId: z.string().uuid().optional().nullable(),
  policyId: z.string().uuid().optional().nullable(),
});

export type AiIngestFileDTO = z.infer<typeof AiIngestFileSchema>;

export const AiIngestTextSchema = z.object({
  content: z.string().min(1, "El campo 'content' es requerido."),
  sourceType: z.enum(["whatsapp", "text"], {
    errorMap: () => ({ message: "sourceType debe ser: whatsapp | text." }),
  }),
  contactId: z.string().uuid().optional().nullable(),
  policyId: z.string().uuid().optional().nullable(),
});

export type AiIngestTextDTO = z.infer<typeof AiIngestTextSchema>;

export const AiProcessDocumentRequestSchema = z.object({
  filePath: z.string().min(1, "El campo 'filePath' es requerido."),
  fileName: z.string().min(1, "El campo 'fileName' es requerido."),
});

export type AiProcessDocumentRequestDTO = z.infer<typeof AiProcessDocumentRequestSchema>;
