import { z } from "zod";
import { SupabaseClient } from "@supabase/supabase-js";
import { IAiProvider } from "../../core/ai_provider.interface.ts";
import { IEmbeddingProvider } from "../../core/embedding_provider.interface.ts";
import { EmbeddingsService, NoteSourceType } from "../rag/embeddings.service.ts";
import { AiSessionService } from "../ai_chat/ai_session.service.ts";
import { StorageService } from "../../modules/storage/storage.service.ts";
import { AiInvokedError, AppError, ValidationError } from "../../shared/errors.ts";

// Solo para archivos binarios (pdf/imagen/audio): extraer texto fiel, sin resumir
const RawExtractionSchema = z.object({
  label: z.string().describe("Topic of this document in the same language as the source, max 5 words. Examples: 'reunión con cliente', 'policy renewal notice', 'audio seguimiento póliza GNP'"),
  content: z.string().describe("Full verbatim text extracted from the document, in the same language as the source. Do NOT summarize — transcribe everything faithfully."),
  responseMessage: z.string().describe("A natural confirmation message in the same language as the source, indicating to the advisor that the document has been successfully processed and summarizing what was found. Max 30 words."),
});

// Para texto plano: generar título descriptivo y confirmación amable
const TextMetadataSchema = z.object({
  label: z.string().describe("Descriptive topic of the text content in the same language, max 5 words. Examples: 'Conversación WhatsApp con Julio', 'Minuta de junta del 5 de junio'"),
  responseMessage: z.string().describe("A friendly confirmation message in the same language, summarizing what was processed in max 30 words."),
});

const FILE_PROMPTS: Record<string, string> = {
  pdf: `You are a document transcription assistant. 1. Detect the primary language of the document. 2. Write a one-line classification of the document type (e.g., Policy, Receipt, ID) IN THAT DETECTED LANGUAGE. 3. Extract ALL text verbatim and accurately, exactly as it appears. Do not translate the extracted text.`,
  image: `You are a claims and document analyst. 1. Detect the primary language of the context or any visible text. 2. Write a detailed description of what you see (objects, visible damage, scene context) IN THAT DETECTED LANGUAGE. 3. Extract all visible text verbatim, exactly as it appears. Do not translate the extracted text.`,
  audio: `You are a transcription assistant. 1. Detect the language spoken in the audio. 2. Write a maximum 2-line summary about the main topic or intent IN THAT DETECTED LANGUAGE. 3. Provide the complete transcription verbatim, word for word, exactly as spoken. Do not translate the transcription.`,
};

const MIME_TO_SOURCE: Record<string, NoteSourceType> = {
  "application/pdf": "pdf",
};

export interface KnowledgeIngestFileInput {
  storagePath: string;
  fileName: string;
  mimeType: string;
  contactId?: string | null;
  policyId?: string | null;
}

export interface KnowledgeIngestTextInput {
  content: string;
  sourceType: "whatsapp" | "text";
  contactId?: string | null;
  policyId?: string | null;
}

export interface KnowledgeIngestResult {
  noteId: string;
  label: string;
  responseMessage: string;
}

export class KnowledgeIngestionService {
  constructor(
    private supabase: SupabaseClient,
    private aiProvider: IAiProvider,
    private embeddingsService: EmbeddingsService,
    private embeddingProvider: IEmbeddingProvider,
    private aiSessionService: AiSessionService,
    private storageService: StorageService,
  ) {}

  async ingestFile(agentId: string, sessionId: string, input: KnowledgeIngestFileInput): Promise<KnowledgeIngestResult> {
    const { storagePath, fileName, mimeType, contactId, policyId } = input;

    // Download throws AppError (pre-AI) — controller will deleteSession on catch
    const base64 = await this.storageService.downloadAsBase64("policies", storagePath);
    const inlineData = { mimeType, data: base64 };

    const sourceType = this.resolveSourceType(mimeType);
    const prompt = FILE_PROMPTS[sourceType] ?? FILE_PROMPTS.pdf;

    // From this point forward, any error must be AiInvokedError so the controller
    // marks the session as failed instead of deleting it.
    let extraction: z.infer<typeof RawExtractionSchema>;
    let extractionUsage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined;
    try {
      const result = await this.aiProvider.generateStructuredData(
        prompt,
        RawExtractionSchema,
        inlineData,
      );
      extraction = result.data;
      extractionUsage = result.usage;
    } catch (err) {
      throw new AiInvokedError(
        `Error en la extracción de IA: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err : undefined,
      );
    }

    try {
      const { data: docMeta } = await this.supabase
        .from("document_metadata")
        .insert({
          agent_id: agentId,
          file_name: fileName,
          storage_path: storagePath,
          mime_type: mimeType,
          ingestion_type: sourceType,
          raw_extraction: { content: extraction.content } as unknown as Record<string, unknown>,
          extracted_at: new Date().toISOString(),
        })
        .select("id")
        .single();

      const { noteId, embeddingTotalTokens, embeddingCount } = await this.embeddingsService.saveDocument(agentId, {
        content: extraction.content,
        sourceType,
        contactId: contactId ?? null,
        policyId: policyId ?? null,
        documentMetadataId: docMeta?.id ?? null,
        metadata: { fileName, documentMetadataId: docMeta?.id },
      });

      await this.aiSessionService.trackIngestionUsage(
        agentId,
        sessionId,
        docMeta?.id ?? null,
        this.aiProvider.model,
        extractionUsage,
        this.embeddingProvider.model,
        embeddingTotalTokens,
        embeddingCount,
      );

      await this.aiSessionService.updateMetadata(sessionId, {
        noteId,
        fileName,
        label: extraction.label,
      });

      return { noteId, label: extraction.label, responseMessage: extraction.responseMessage };
    } catch (err) {
      if (err instanceof AppError) {
        throw new AiInvokedError(err.message, err);
      }
      throw new AiInvokedError(
        `Error post-extracción de IA: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err : undefined,
      );
    }
  }

  async ingestText(agentId: string, sessionId: string, input: KnowledgeIngestTextInput): Promise<KnowledgeIngestResult> {
    const { content, sourceType, contactId, policyId } = input;
    return await this.ingestRawContent(agentId, sessionId, content, sourceType, contactId ?? null, policyId ?? null);
  }

  private async ingestRawContent(
    agentId: string,
    sessionId: string,
    content: string,
    sourceType: NoteSourceType,
    contactId: string | null,
    policyId: string | null,
  ): Promise<KnowledgeIngestResult> {

    const isLong = content.length > 4000;
    const excerpt = isLong ? content.slice(0, 4000) : content;
    const lengthNote = isLong
      ? `\n\n[Note: This is an excerpt of a longer text (${content.length} total characters). Generate a label and message that reflect the overall content based on this excerpt.]`
      : "";

    const prompt =
      `You are an AI assistant helping an insurance advisor manage their knowledge base.\n` +
      `Analyze the following text and generate:\n` +
      `1. A descriptive label (max 5 words) that accurately classifies the content type and topic.\n` +
      `2. A friendly confirmation message (max 30 words) for the advisor summarizing what was saved.\n\n` +
      `Text content:\n${excerpt}${lengthNote}`;

    let metadata: z.infer<typeof TextMetadataSchema>;
    let extractionUsage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined;
    try {
      const result = await this.aiProvider.generateStructuredData(
        prompt,
        TextMetadataSchema,
      );
      metadata = result.data;
      extractionUsage = result.usage;
    } catch (err) {
      throw new AiInvokedError(
        `Error en la generación de metadata de IA: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err : undefined,
      );
    }

    try {
      const { noteId, embeddingTotalTokens, embeddingCount } = await this.embeddingsService.saveDocument(agentId, {
        content,
        sourceType,
        contactId,
        policyId,
        metadata: { sourceType },
      });

      await this.aiSessionService.trackIngestionUsage(
        agentId,
        sessionId,
        null,
        this.aiProvider.model,
        extractionUsage,
        this.embeddingProvider.model,
        embeddingTotalTokens,
        embeddingCount,
      );

      await this.aiSessionService.updateMetadata(sessionId, {
        noteId,
        sourceType,
        label: metadata.label,
      });

      return {
        noteId,
        label: metadata.label,
        responseMessage: metadata.responseMessage,
      };
    } catch (err) {
      if (err instanceof AppError) {
        throw new AiInvokedError(err.message, err);
      }
      throw new AiInvokedError(
        `Error post-generación de IA: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err : undefined,
      );
    }
  }

  private resolveSourceType(mimeType: string): NoteSourceType {
    if (MIME_TO_SOURCE[mimeType]) return MIME_TO_SOURCE[mimeType];
    if (mimeType.startsWith("image/")) return "image";
    if (mimeType.startsWith("audio/")) return "audio";
    throw new ValidationError(`Tipo de archivo no soportado para ingesta: ${mimeType}`);
  }
}
