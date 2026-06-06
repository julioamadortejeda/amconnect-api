import { z } from "zod";
import { SupabaseClient } from "@supabase/supabase-js";
import { IAiProvider } from "../../core/ai_provider.interface.ts";
import { EmbeddingsService } from "../rag/embeddings.service.ts";
import { AppError } from "../../shared/errors.ts";
import {
  POLICY_EXTRACTION_PROMPT,
  PolicyExtraction,
  PolicyExtractionSchema,
} from "./policy_extraction.schema.ts";

// ─── Schema para extracción genérica (imágenes, audios, textos) ───────────────

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
  image: `Eres el asistente de un asesor de seguros en México. Analiza esta imagen y extrae TODA la información relevante: nombres, fechas, números de póliza, montos, datos de contacto, coberturas u otros datos importantes. Genera un resumen estructurado.`,
  audio: `Eres el asistente de un asesor de seguros en México. Transcribe y analiza este audio. Extrae nombres mencionados, compromisos, fechas, montos, números de póliza y cualquier dato relevante para la cartera del asesor.`,
  whatsapp: `Eres el asistente de un asesor de seguros en México. Analiza esta conversación de WhatsApp y extrae información relevante: datos de clientes, pólizas mencionadas, fechas de seguimiento, compromisos del asesor u otros datos importantes.`,
  text: `Eres el asistente de un asesor de seguros en México. Analiza el siguiente texto y extrae toda la información relevante para la gestión de cartera: datos de clientes, pólizas, coberturas, fechas u otros datos importantes.`,
};

export type IngestionType = "pdf" | "image" | "audio" | "whatsapp" | "text";

export interface IngestFileInput {
  storagePath: string;
  fileName: string;
  mimeType: string;
  contactId?: string | null;
  policyId?: string | null;
}

export interface IngestTextInput {
  content: string;
  sourceType: "whatsapp" | "text";
  contactId?: string | null;
  policyId?: string | null;
}

export interface IngestResult {
  documentMetadataId: string;
  ingestionType: IngestionType;
  extraction: PolicyExtraction | GenericExtraction;
  // Solo presente cuando ingestionType = 'pdf'
  policyExtraction?: PolicyExtraction;
}

export class IngestionService {
  constructor(
    private supabase: SupabaseClient,
    private aiProvider: IAiProvider,
    private embeddingsService: EmbeddingsService,
  ) {}

  async ingestFile(agentId: string, input: IngestFileInput): Promise<IngestResult> {
    const { storagePath, fileName, mimeType, contactId, policyId } = input;

    // Descargar archivo de Storage
    const { data: fileData, error: downloadError } = await this.supabase.storage
      .from("policies")
      .download(storagePath);

    if (downloadError || !fileData) {
      throw new AppError(`No se pudo descargar el archivo: ${downloadError?.message}`, 500);
    }

    const arrayBuffer = await fileData.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(arrayBuffer)));
    const inlineData = { mimeType, data: base64 };

    const ingestionType = this.getMimeIngestionType(mimeType);

    let extraction: PolicyExtraction | GenericExtraction;
    let noteContent: string;

    if (ingestionType === "pdf") {
      const result = await this.aiProvider.generateStructuredData(
        POLICY_EXTRACTION_PROMPT,
        PolicyExtractionSchema,
        inlineData,
      );
      extraction = result.data;
      noteContent = this.buildPolicyNote(extraction as PolicyExtraction, fileName);
    } else {
      const prompt = PROMPTS[ingestionType] ?? PROMPTS.text;
      const result = await this.aiProvider.generateStructuredData(
        prompt,
        GenericExtractionSchema,
        inlineData,
      );
      extraction = result.data;
      noteContent = this.buildGenericNote(extraction as GenericExtraction, fileName);
    }

    return await this.saveIngestion(agentId, {
      fileName,
      storagePath,
      mimeType,
      ingestionType,
      contactId: contactId ?? null,
      policyId: policyId ?? null,
      extraction,
      noteContent,
    });
  }

  async ingestText(agentId: string, input: IngestTextInput): Promise<IngestResult> {
    const { content, sourceType, contactId, policyId } = input;
    const prompt = PROMPTS[sourceType];

    const result = await this.aiProvider.generateStructuredData(
      `${prompt}\n\nTexto a analizar:\n${content}`,
      GenericExtractionSchema,
    );

    const extraction = result.data;
    const noteContent = this.buildGenericNote(extraction, `${sourceType}_${Date.now()}`);
    const fileName = sourceType === "whatsapp" ? "whatsapp_export.txt" : "nota.txt";

    return await this.saveIngestion(agentId, {
      fileName,
      storagePath: "",
      mimeType: "text/plain",
      ingestionType: sourceType,
      contactId: contactId ?? null,
      policyId: policyId ?? null,
      extraction,
      noteContent,
    });
  }

  private async saveIngestion(agentId: string, params: {
    fileName: string;
    storagePath: string;
    mimeType: string;
    ingestionType: IngestionType;
    contactId: string | null;
    policyId: string | null;
    extraction: PolicyExtraction | GenericExtraction;
    noteContent: string;
  }): Promise<IngestResult> {
    const { data: docMeta } = await this.supabase
      .from("document_metadata")
      .insert({
        agent_id: agentId,
        file_name: params.fileName,
        storage_path: params.storagePath,
        mime_type: params.mimeType,
        ingestion_type: params.ingestionType,
        contact_id: params.contactId,
        policy_id: params.policyId,
        raw_extraction: params.extraction as unknown as Record<string, unknown>,
        extracted_at: new Date().toISOString(),
      })
      .select("id")
      .single();

    await this.embeddingsService.saveNote(agentId, {
      content: params.noteContent,
      contactId: params.contactId,
      policyId: params.policyId,
      metadata: {
        source: "ingestion",
        ingestionType: params.ingestionType,
        fileName: params.fileName,
        documentMetadataId: docMeta?.id,
      },
    });

    return {
      documentMetadataId: docMeta?.id ?? "",
      ingestionType: params.ingestionType,
      extraction: params.extraction,
      ...(params.ingestionType === "pdf" ? { policyExtraction: params.extraction as PolicyExtraction } : {}),
    };
  }

  private getMimeIngestionType(mimeType: string): IngestionType {
    if (mimeType === "application/pdf") return "pdf";
    if (mimeType.startsWith("image/")) return "image";
    if (mimeType.startsWith("audio/")) return "audio";
    return "text";
  }

  private buildPolicyNote(extraction: PolicyExtraction, fileName: string): string {
    return [
      `Póliza procesada desde: ${fileName}`,
      extraction.policyNumber ? `Número: ${extraction.policyNumber}` : null,
      extraction.carrierName ? `Aseguradora: ${extraction.carrierName}` : null,
      extraction.holderName ? `Titular: ${extraction.holderName}` : null,
      extraction.sumInsured ? `Suma asegurada: ${extraction.currency ?? "MXN"} ${extraction.sumInsured}` : null,
      extraction.premium ? `Prima: ${extraction.currency ?? "MXN"} ${extraction.premium}` : null,
      extraction.startDate ? `Vigencia: ${extraction.startDate} al ${extraction.endDate}` : null,
      extraction.beneficiaries.length > 0
        ? `Beneficiarios: ${extraction.beneficiaries.map((b) => `${b.fullName} (${b.percentage ?? "?"}%)`).join(", ")}`
        : null,
    ].filter(Boolean).join(". ");
  }

  private buildGenericNote(extraction: GenericExtraction, fileName: string): string {
    return [
      `Documento: ${fileName}`,
      extraction.summary,
      extraction.keyPoints.length > 0 ? `Puntos clave: ${extraction.keyPoints.join("; ")}` : null,
      extraction.mentions.names.length > 0 ? `Personas: ${extraction.mentions.names.join(", ")}` : null,
      extraction.mentions.policyNumbers.length > 0 ? `Pólizas: ${extraction.mentions.policyNumbers.join(", ")}` : null,
    ].filter(Boolean).join(". ");
  }
}
