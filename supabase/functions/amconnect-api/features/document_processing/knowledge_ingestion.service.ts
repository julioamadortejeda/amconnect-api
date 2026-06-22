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
  summary: z.string().describe("1-2 sentence human-readable description of the document content in the advisor's language (as instructed in the system prompt). Describe what was found in a way useful for an insurance advisor to quickly understand the note without reading the full content."),
  content: z.string().describe("Full verbatim text extracted from the document, in the same language as the source. Do NOT summarize — transcribe everything faithfully."),
  responseMessage: z.string().describe("A friendly confirmation message in the advisor's language (as instructed in the system prompt), indicating the document was successfully processed. Max 30 words."),
});

// Para texto plano: generar título descriptivo y confirmación amable
const TextMetadataSchema = z.object({
  summary: z.string().describe("1-2 sentence human-readable description of the text content in the advisor's language (as instructed in the system prompt). Describe what it's about in a way useful for an insurance advisor."),
  responseMessage: z.string().describe("A friendly confirmation message in the advisor's language (as instructed in the system prompt), summarizing what was processed in max 30 words."),
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
  advisorLocale?: string;
}

export interface KnowledgeIngestTextInput {
  content: string;
  sourceType: "whatsapp" | "text";
  contactId?: string | null;
  policyId?: string | null;
  advisorLocale?: string;
}

export interface KnowledgeIngestResult {
  noteId: string;
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
    const { storagePath, fileName, mimeType, contactId, policyId, advisorLocale = 'es' } = input;

    // Download throws AppError (pre-AI) — controller will deleteSession on catch
    const base64 = await this.storageService.downloadAsBase64("policies", storagePath);
    const inlineData = { mimeType, data: base64 };

    const sourceType = this.resolveSourceType(mimeType);
    let dbPromptCode = "knowledge_pdf_system";
    if (sourceType === "image") dbPromptCode = "knowledge_image_system";
    else if (sourceType === "audio") dbPromptCode = "knowledge_audio_system";

    const rawLocale = advisorLocale.split(/[-_]/)[0].toLowerCase();
    const cleanLangName = rawLocale === 'en' ? 'English' : 'Spanish';

    const prompt = (await this.promptService.getPrompt(dbPromptCode))
      .replaceAll('{{advisor_language}}', cleanLangName);

    // From this point forward, any error must be AiInvokedError so the controller
    // marks the session as failed instead of deleting it.
    let extraction: z.infer<typeof RawExtractionSchema>;
    let extractionUsage: { promptTokens: number; completionTokens: number; totalTokens: number; cachedTokens?: number } | undefined;
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
        noteOrigin: 'knowledge',
        summary: extraction.summary,
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
      });

      return { noteId, responseMessage: extraction.responseMessage };
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
    const { content, sourceType, contactId, policyId, advisorLocale = 'es' } = input;
    return await this.ingestRawContent(agentId, sessionId, content, sourceType, contactId ?? null, policyId ?? null, advisorLocale);
  }

  private async ingestRawContent(
    agentId: string,
    sessionId: string,
    content: string,
    sourceType: NoteSourceType,
    contactId: string | null,
    policyId: string | null,
    advisorLocale: string = 'es',
  ): Promise<KnowledgeIngestResult> {
    const isLong = content.length > 4000;
    const excerpt = isLong ? content.slice(0, 4000) : content;
    const lengthNote = isLong
      ? `\n\n[Note: This is an excerpt of a longer text (${content.length} total characters). Generate a label and message that reflect the overall content based on this excerpt.]`
      : "";

    const rawLocale = advisorLocale.split(/[-_]/)[0].toLowerCase();
    const cleanLangName = rawLocale === 'en' ? 'English' : 'Spanish';

    const promptTemplate = await this.promptService.getPrompt("knowledge_text_metadata_system");
    const prompt = promptTemplate
      .replace("{excerpt}", excerpt)
      .replace("{lengthNote}", lengthNote)
      .replaceAll('{{advisor_language}}', cleanLangName);

    let aiResult: { data: z.infer<typeof TextMetadataSchema>; usage?: { promptTokens: number; completionTokens: number; totalTokens: number; cachedTokens?: number } };
    let docResult: { noteId: string; embeddingTotalTokens: number; embeddingCount: number };
    try {
      aiResult = await this.aiProvider.generateStructuredData(prompt, TextMetadataSchema);
      docResult = await this.embeddingsService.saveDocument(agentId, {
        content,
        sourceType,
        contactId,
        policyId,
        noteOrigin: 'knowledge',
        summary: aiResult.data.summary,
      });
    } catch (err) {
      if (err instanceof AiProviderError) throw err;
      throw new AiInvokedError(
        `Error en la generación de IA: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err : undefined,
      );
    }

    try {
      await Promise.all([
        this.aiSessionService.trackIngestionUsage(
          agentId,
          sessionId,
          null,
          this.aiProvider.model,
          aiResult.usage,
          this.embeddingProvider.model,
          docResult.embeddingTotalTokens,
          docResult.embeddingCount,
        ),
        this.aiSessionService.updateMetadata(sessionId, {
          noteId: docResult.noteId,
          sourceType,
        }),
      ]);

      return {
        noteId: docResult.noteId,
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
