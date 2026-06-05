import { z } from "zod";
import { SupabaseClient } from "@supabase/supabase-js";
import { IAiProvider } from "../../core/ai_provider.interface.ts";
import { IEmbeddingProvider } from "../../core/embedding_provider.interface.ts";
import { EmbeddingsService, NoteSourceType } from "../rag/embeddings.service.ts";
import { AppError, ValidationError } from "../../shared/errors.ts";

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}

// Solo para archivos binarios (pdf/imagen/audio): extraer texto fiel, sin resumir
const RawExtractionSchema = z.object({
  label: z.string().describe("Topic of this document in the same language as the source, max 5 words. Examples: 'reunión con cliente', 'policy renewal notice', 'audio seguimiento póliza GNP'"),
  content: z.string().describe("Full verbatim text extracted from the document, in the same language as the source. Do NOT summarize — transcribe everything faithfully."),
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
}

export class KnowledgeIngestionService {
  constructor(
    private supabase: SupabaseClient,
    private aiProvider: IAiProvider,
    private embeddingsService: EmbeddingsService,
    private embeddingProvider: IEmbeddingProvider,
  ) {}

  async ingestFile(agentId: string, input: KnowledgeIngestFileInput): Promise<KnowledgeIngestResult> {
    const { storagePath, fileName, mimeType, contactId, policyId } = input;
    console.log(`[INGEST:file] start — agent=${agentId} file=${fileName} mime=${mimeType}`);

    const { data: fileData, error: downloadError } = await this.supabase.storage
      .from("policies")
      .download(storagePath);

    if (downloadError || !fileData) {
      throw new AppError(`No se pudo descargar el archivo: ${downloadError?.message}`, 500);
    }
    console.log(`[INGEST:file] downloaded — bytes=${fileData.size}`);

    const arrayBuffer = await fileData.arrayBuffer();
    const base64 = arrayBufferToBase64(arrayBuffer);
    const inlineData = { mimeType, data: base64 };

    const sourceType = this.resolveSourceType(mimeType);
    const prompt = FILE_PROMPTS[sourceType] ?? FILE_PROMPTS.pdf;
    console.log(`[INGEST:file] calling AI extraction — sourceType=${sourceType}`);

    const { data: extraction, usage: extractionUsage } = await this.aiProvider.generateStructuredData(
      prompt,
      RawExtractionSchema,
      inlineData,
    );
    console.log(`[INGEST:file] AI extraction done — label="${extraction.label}" contentLength=${extraction.content.length} tokens=${JSON.stringify(extractionUsage)}`);

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
    console.log(`[INGEST:file] document_metadata saved — id=${docMeta?.id}`);

    const { noteId, embeddingTotalTokens, embeddingCount } = await this.embeddingsService.saveDocument(agentId, {
      aiContent: extraction.content,
      sourceType,
      contactId: contactId ?? null,
      policyId: policyId ?? null,
      documentMetadataId: docMeta?.id ?? null,
      metadata: { fileName, documentMetadataId: docMeta?.id },
    });
    console.log(`[INGEST:file] done — noteId=${noteId} chunks=${embeddingCount} embeddingTokens=${embeddingTotalTokens}`);

    await this.saveIngestionUsage(agentId, docMeta?.id ?? null, extractionUsage, embeddingTotalTokens, embeddingCount);

    return { noteId, label: extraction.label };
  }

  async ingestText(agentId: string, input: KnowledgeIngestTextInput): Promise<KnowledgeIngestResult> {
    const { content, sourceType, contactId, policyId } = input;
    console.log(`[INGEST:text] start — agent=${agentId} sourceType=${sourceType} contentLength=${content.length}`);
    return this.ingestRawContent(agentId, content, sourceType, contactId ?? null, policyId ?? null);
  }

  private async ingestRawContent(
    agentId: string,
    content: string,
    sourceType: NoteSourceType,
    contactId: string | null,
    policyId: string | null,
  ): Promise<KnowledgeIngestResult> {
    console.log(`[INGEST:text] skipping AI — embedding raw content directly`);

    const { noteId, embeddingTotalTokens, embeddingCount } = await this.embeddingsService.saveDocument(agentId, {
      aiContent: content,
      sourceType,
      contactId,
      policyId,
      metadata: { sourceType },
    });

    const label = content.slice(0, 60).replace(/\s+/g, " ").trim();
    console.log(`[INGEST:text] done — noteId=${noteId} chunks=${embeddingCount} embeddingTokens=${embeddingTotalTokens} label="${label}"`);

    await this.saveEmbeddingUsage(agentId, null, embeddingTotalTokens, embeddingCount);

    return { noteId, label };
  }

  private async saveIngestionUsage(
    agentId: string,
    documentMetadataId: string | null,
    extractionUsage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined,
    embeddingTotalTokens: number,
    embeddingCount: number,
  ): Promise<void> {
    await this.supabase.from("ai_ingestion_usage").insert([
      {
        agent_id: agentId,
        session_id: null,
        document_metadata_id: documentMetadataId,
        operation: "extraction",
        model_name: this.aiProvider.model,
        prompt_tokens: extractionUsage?.promptTokens ?? 0,
        completion_tokens: extractionUsage?.completionTokens ?? 0,
        total_tokens: extractionUsage?.totalTokens ?? 0,
        item_count: 1,
      },
      {
        agent_id: agentId,
        session_id: null,
        document_metadata_id: documentMetadataId,
        operation: "embedding",
        model_name: this.embeddingProvider.model,
        prompt_tokens: 0,
        completion_tokens: 0,
        total_tokens: embeddingTotalTokens,
        item_count: embeddingCount,
      },
    ]);
  }

  private async saveEmbeddingUsage(
    agentId: string,
    documentMetadataId: string | null,
    embeddingTotalTokens: number,
    embeddingCount: number,
  ): Promise<void> {
    await this.supabase.from("ai_ingestion_usage").insert({
      agent_id: agentId,
      session_id: null,
      document_metadata_id: documentMetadataId,
      operation: "embedding",
      model_name: this.embeddingProvider.model,
      prompt_tokens: 0,
      completion_tokens: 0,
      total_tokens: embeddingTotalTokens,
      item_count: embeddingCount,
    });
  }

  private resolveSourceType(mimeType: string): NoteSourceType {
    if (MIME_TO_SOURCE[mimeType]) return MIME_TO_SOURCE[mimeType];
    if (mimeType.startsWith("image/")) return "image";
    if (mimeType.startsWith("audio/")) return "audio";
    throw new ValidationError(`Tipo de archivo no soportado para ingesta: ${mimeType}`);
  }
}
