import { z } from "zod";
import { IAiProvider } from "../../core/ai_provider.interface.ts";
import { IEmbeddingProvider } from "../../core/embedding_provider.interface.ts";
import { EmbeddingsService, NoteSourceType } from "../rag/embeddings.service.ts";
import { AiSessionService } from "../ai_chat/ai_session.service.ts";
import { StorageService } from "../../modules/storage/storage.service.ts";
import { DocumentMetadataRepository } from "../../modules/document_metadata/document_metadata.repository.ts";
import { AiInvokedError, AiProviderError, AppError, ValidationError } from "../../shared/errors.ts";
import { PromptService } from "../../modules/prompt/prompt.service.ts";

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

// FILE_PROMPTS moved to database

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
    private documentMetadataRepository: DocumentMetadataRepository,
    private aiProvider: IAiProvider,
    private embeddingsService: EmbeddingsService,
    private embeddingProvider: IEmbeddingProvider,
    private aiSessionService: AiSessionService,
    private storageService: StorageService,
    private promptService: PromptService,
  ) {}

  async ingestFile(agentId: string, sessionId: string, input: KnowledgeIngestFileInput): Promise<KnowledgeIngestResult> {
    debugger;
    const { storagePath, fileName, mimeType, contactId, policyId } = input;

    // Download throws AppError (pre-AI) — controller will deleteSession on catch
    const base64 = await this.storageService.downloadAsBase64("policies", storagePath);
    const inlineData = { mimeType, data: base64 };

    const sourceType = this.resolveSourceType(mimeType);
    let dbPromptCode = "knowledge_pdf_system";
    if (sourceType === "image") dbPromptCode = "knowledge_image_system";
    else if (sourceType === "audio") dbPromptCode = "knowledge_audio_system";

    const prompt = await this.promptService.getPrompt(dbPromptCode);

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
      if (err instanceof AiProviderError) throw err;
      throw new AiInvokedError(
        `Error en la extracción de IA: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err : undefined,
      );
    }

    try {
      const docMeta = await this.documentMetadataRepository.create({
        agent_id: agentId,
        file_name: fileName,
        storage_path: storagePath,
        mime_type: mimeType,
        ingestion_type: sourceType,
        raw_extraction: { content: extraction.content },
        extracted_at: new Date().toISOString(),
      });

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
    debugger;
    const isLong = content.length > 4000;
    const excerpt = isLong ? content.slice(0, 4000) : content;
    const lengthNote = isLong
      ? `\n\n[Note: This is an excerpt of a longer text (${content.length} total characters). Generate a label and message that reflect the overall content based on this excerpt.]`
      : "";

    const promptTemplate = await this.promptService.getPrompt("knowledge_text_metadata_system");
    const prompt = promptTemplate
      .replace("{excerpt}", excerpt)
      .replace("{lengthNote}", lengthNote);

    // LLM (metadata) y embeddings (saveDocument) son independientes — corren en paralelo
    let aiResult: { data: z.infer<typeof TextMetadataSchema>; usage?: { promptTokens: number; completionTokens: number; totalTokens: number } };
    let docResult: { noteId: string; embeddingTotalTokens: number; embeddingCount: number };
    try {
      [aiResult, docResult] = await Promise.all([
        this.aiProvider.generateStructuredData(prompt, TextMetadataSchema),
        this.embeddingsService.saveDocument(agentId, {
          content,
          sourceType,
          contactId,
          policyId,
          metadata: { sourceType },
        }),
      ]);
    } catch (err) {
      if (err instanceof AiProviderError) throw err;
      throw new AiInvokedError(
        `Error en la generación de IA: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err : undefined,
      );
    }

    try {
      await this.aiSessionService.trackIngestionUsage(
        agentId,
        sessionId,
        null,
        this.aiProvider.model,
        aiResult.usage,
        this.embeddingProvider.model,
        docResult.embeddingTotalTokens,
        docResult.embeddingCount,
      );

      await this.aiSessionService.updateMetadata(sessionId, {
        noteId: docResult.noteId,
        sourceType,
        label: aiResult.data.label,
      });

      return {
        noteId: docResult.noteId,
        label: aiResult.data.label,
        responseMessage: aiResult.data.responseMessage,
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
