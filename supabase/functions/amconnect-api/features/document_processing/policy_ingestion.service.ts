import { SupabaseClient } from "@supabase/supabase-js";
import { IAiProvider, TokenUsage } from "../../core/ai_provider.interface.ts";
import { IEmbeddingProvider } from "../../core/embedding_provider.interface.ts";
import { EmbeddingsService } from "../rag/embeddings.service.ts";
import { AppError } from "../../shared/errors.ts";

function arrayBufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.byteLength; i += 8192) {
    binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
  }
  return btoa(binary);
}
import {
  POLICY_EXTRACTION_PROMPT,
  PolicyExtraction,
  PolicyExtractionSchema,
} from "./policy_extraction.schema.ts";

export interface IngestionUsageData {
  extractionUsage: TokenUsage;
  embeddingTotalTokens: number;
  embeddingCount: number;
  embeddingModelName: string;
  documentMetadataId: string;
}

export interface PolicyIngestInput {
  storagePath: string;
  fileName: string;
  mimeType: string;
  contactId?: string | null;
}

export interface PolicyIngestResult {
  documentMetadataId: string;
  noteId: string;
  extraction: PolicyExtraction;
  ingestionUsage: IngestionUsageData;
}

export class PolicyIngestionService {
  constructor(
    private supabase: SupabaseClient,
    private aiProvider: IAiProvider,
    private embeddingsService: EmbeddingsService,
    private embeddingProvider: IEmbeddingProvider,
  ) {}

  async extract(agentId: string, input: PolicyIngestInput): Promise<PolicyIngestResult> {
    const { storagePath, fileName, mimeType, contactId } = input;

    const { data: fileData, error: downloadError } = await this.supabase.storage
      .from("policies")
      .download(storagePath);

    if (downloadError || !fileData) {
      throw new AppError(`No se pudo descargar el archivo: ${downloadError?.message}`, 500);
    }

    const arrayBuffer = await fileData.arrayBuffer();
    const base64 = arrayBufferToBase64(arrayBuffer);

    const { data: extraction, usage: extractionUsage } = await this.aiProvider.generateStructuredData(
      POLICY_EXTRACTION_PROMPT,
      PolicyExtractionSchema,
      { mimeType, data: base64 },
    );

    const { data: docMeta, error: docError } = await this.supabase
      .from("document_metadata")
      .insert({
        agent_id: agentId,
        file_name: fileName,
        storage_path: storagePath,
        mime_type: mimeType,
        ingestion_type: "pdf",
        raw_extraction: extraction as unknown as Record<string, unknown>,
        extracted_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    if (docError || !docMeta) throw new AppError("No se pudo guardar los metadatos del documento.", 500);

    const { noteId, embeddingTotalTokens, embeddingCount } = await this.embeddingsService.saveDocument(agentId, {
      aiContent: extraction.summary,
      sourceType: "pdf",
      contactId: contactId ?? null,
      documentMetadataId: docMeta.id,
      metadata: { intent: "policy", fileName, documentMetadataId: docMeta.id },
    });

    return {
      documentMetadataId: docMeta.id,
      noteId,
      extraction,
      ingestionUsage: {
        extractionUsage: extractionUsage ?? { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        embeddingTotalTokens,
        embeddingCount,
        embeddingModelName: this.embeddingProvider.model,
        documentMetadataId: docMeta.id,
      },
    };
  }
}
