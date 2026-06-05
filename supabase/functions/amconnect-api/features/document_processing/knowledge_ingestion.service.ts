import { z } from "zod";
import { SupabaseClient } from "@supabase/supabase-js";
import { IAiProvider } from "../../core/ai_provider.interface.ts";
import { EmbeddingsService, NoteSourceType } from "../rag/embeddings.service.ts";
import { AppError } from "../../shared/errors.ts";

const GenericExtractionSchema = z.object({
  summary: z.string().describe("Resumen de la información extraída"),
  keyPoints: z.array(z.string()).default([]).describe("Puntos clave de información"),
  mentions: z.object({
    names: z.array(z.string()).default([]).describe("Nombres de personas mencionadas"),
    dates: z.array(z.string()).default([]).describe("Fechas relevantes"),
    amounts: z.array(z.string()).default([]).describe("Montos o cantidades"),
    policyNumbers: z.array(z.string()).default([]).describe("Números de póliza"),
  }),
});

type GenericExtraction = z.infer<typeof GenericExtractionSchema>;

const PROMPTS: Record<string, string> = {
  image: `You are an assistant for a Mexican insurance advisor. Analyze this image and extract ALL relevant information: names, dates, policy numbers, amounts, contact details, coverages, or other important data. Generate a structured summary in English.`,
  audio: `You are an assistant for a Mexican insurance advisor. Transcribe and analyze this audio. Extract names, commitments, dates, amounts, policy numbers, and any data relevant to the advisor's portfolio. Respond in English.`,
  document: `You are an assistant for a Mexican insurance advisor. Analyze this document and extract all relevant information: coverages, exclusions, conditions, amounts, validity periods, and important data for portfolio management. Respond in English.`,
  whatsapp: `You are an assistant for a Mexican insurance advisor. Analyze this WhatsApp conversation and extract relevant information: client data, mentioned policies, follow-up dates, advisor commitments, or other important data. Respond in English.`,
  text: `You are an assistant for a Mexican insurance advisor. Analyze the following text and extract all relevant information for portfolio management: client data, policies, coverages, dates, or other important data. Respond in English.`,
};

const MIME_TO_SOURCE: Record<string, NoteSourceType> = {
  "application/pdf": "pdf",
  "application/msword": "document",
  "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "document",
  "application/vnd.ms-excel": "document",
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet": "document",
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
  sourceType: NoteSourceType;
  extraction: GenericExtraction;
}

export class KnowledgeIngestionService {
  constructor(
    private supabase: SupabaseClient,
    private aiProvider: IAiProvider,
    private embeddingsService: EmbeddingsService,
  ) {}

  async ingestFile(agentId: string, input: KnowledgeIngestFileInput): Promise<KnowledgeIngestResult> {
    const { storagePath, fileName, mimeType, contactId, policyId } = input;

    const { data: fileData, error: downloadError } = await this.supabase.storage
      .from("policies")
      .download(storagePath);

    if (downloadError || !fileData) {
      throw new AppError(`No se pudo descargar el archivo: ${downloadError?.message}`, 500);
    }

    const arrayBuffer = await fileData.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
    const inlineData = { mimeType, data: base64 };

    const sourceType = this.resolveSourceType(mimeType);
    const prompt = PROMPTS[sourceType] ?? PROMPTS.text;

    const { data: extraction } = await this.aiProvider.generateStructuredData(
      prompt,
      GenericExtractionSchema,
      inlineData,
    );

    const aiContent = this.buildAiContent(extraction, fileName);

    const { data: docMeta } = await this.supabase
      .from("document_metadata")
      .insert({
        agent_id: agentId,
        file_name: fileName,
        storage_path: storagePath,
        mime_type: mimeType,
        ingestion_type: sourceType,
        raw_extraction: extraction as unknown as Record<string, unknown>,
        extracted_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    const noteId = await this.embeddingsService.saveDocument(agentId, {
      aiContent,
      sourceType,
      contactId: contactId ?? null,
      policyId: policyId ?? null,
      documentMetadataId: docMeta?.id ?? null,
      metadata: { fileName, documentMetadataId: docMeta?.id },
    });

    return { noteId, sourceType, extraction };
  }

  async ingestText(agentId: string, input: KnowledgeIngestTextInput): Promise<KnowledgeIngestResult> {
    const { content, sourceType, contactId, policyId } = input;
    const prompt = PROMPTS[sourceType];

    const { data: extraction } = await this.aiProvider.generateStructuredData(
      `${prompt}\n\nTexto a analizar:\n${content}`,
      GenericExtractionSchema,
    );

    const fileName = sourceType === "whatsapp" ? "whatsapp_export.txt" : "nota.txt";
    const aiContent = this.buildAiContent(extraction, fileName);

    const { data: docMeta } = await this.supabase
      .from("document_metadata")
      .insert({
        agent_id: agentId,
        file_name: fileName,
        storage_path: "",
        mime_type: "text/plain",
        ingestion_type: sourceType,
        raw_extraction: extraction as unknown as Record<string, unknown>,
        extracted_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    const noteId = await this.embeddingsService.saveDocument(agentId, {
      aiContent,
      sourceType: "text",
      contactId: contactId ?? null,
      policyId: policyId ?? null,
      documentMetadataId: docMeta?.id ?? null,
      metadata: { sourceType, documentMetadataId: docMeta?.id },
    });

    return { noteId, sourceType: "text", extraction };
  }

  private resolveSourceType(mimeType: string): NoteSourceType {
    if (MIME_TO_SOURCE[mimeType]) return MIME_TO_SOURCE[mimeType];
    if (mimeType.startsWith("image/")) return "image";
    if (mimeType.startsWith("audio/")) return "audio";
    return "document";
  }

  private buildAiContent(extraction: GenericExtraction, fileName: string): string {
    return [
      `Documento: ${fileName}`,
      extraction.summary,
      extraction.keyPoints.length > 0 ? `Puntos clave: ${extraction.keyPoints.join("; ")}` : null,
      extraction.mentions.names.length > 0 ? `Personas: ${extraction.mentions.names.join(", ")}` : null,
      extraction.mentions.policyNumbers.length > 0 ? `Pólizas: ${extraction.mentions.policyNumbers.join(", ")}` : null,
      extraction.mentions.amounts.length > 0 ? `Montos: ${extraction.mentions.amounts.join(", ")}` : null,
    ].filter(Boolean).join(". ");
  }
}
