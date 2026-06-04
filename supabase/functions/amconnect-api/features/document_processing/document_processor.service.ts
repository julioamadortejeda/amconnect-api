import { SupabaseClient } from "@supabase/supabase-js";
import { IAiProvider } from "../../core/ai_provider.interface.ts";
import { AppError, ForbiddenError } from "../../shared/errors.ts";
import {
  POLICY_EXTRACTION_PROMPT,
  PolicyExtraction,
  PolicyExtractionSchema,
} from "./policy_extraction.schema.ts";
import { EmbeddingsService } from "../rag/embeddings.service.ts";

export class DocumentProcessorService {
  constructor(
    private supabase: SupabaseClient,
    private docAiProvider: IAiProvider,   // Vertex AI (pro) o Gemini (free, si se permite)
    private embeddingsService: EmbeddingsService,
  ) {}

  async processDocument(
    agentId: string,
    storagePath: string,
    fileName: string,
    agentPlan: "free" | "pro",
  ): Promise<{ extraction: PolicyExtraction; documentMetadataId: string }> {
    if (agentPlan === "free") {
      throw new ForbiddenError(
        "El procesamiento de pólizas PDF está disponible solo en el plan Pro.",
      );
    }

    // Descargar el PDF desde Supabase Storage
    const { data: fileData, error: downloadError } = await this.supabase.storage
      .from("policies")
      .download(storagePath);

    if (downloadError || !fileData) {
      throw new AppError(`No se pudo descargar el documento: ${downloadError?.message}`, 500);
    }

    // Convertir Blob a base64
    const arrayBuffer = await fileData.arrayBuffer();
    const base64 = btoa(
      String.fromCharCode(...new Uint8Array(arrayBuffer)),
    );

    // Extraer datos estructurados con IA
    const { data: extraction } = await this.docAiProvider.generateStructuredData(
      POLICY_EXTRACTION_PROMPT,
      PolicyExtractionSchema,
      { mimeType: "application/pdf", data: base64 },
    );

    // Guardar metadatos del documento
    const { data: docMeta, error: metaError } = await this.supabase
      .from("document_metadata")
      .insert({
        agent_id: agentId,
        file_name: fileName,
        storage_path: storagePath,
        mime_type: "application/pdf",
        raw_extraction: extraction as unknown as Record<string, unknown>,
        extracted_at: new Date().toISOString(),
      })
      .select()
      .single();

    if (metaError) {
      console.error("[DocumentProcessor] Error guardando metadata:", metaError);
    }

    // Generar embeddings de la info extraída para RAG
    const noteContent = this.buildNoteFromExtraction(extraction, fileName);
    await this.embeddingsService.saveNote(agentId, {
      content: noteContent,
      metadata: { source: "policy_document", storagePath, fileName },
    });

    return {
      extraction,
      documentMetadataId: docMeta?.id ?? "",
    };
  }

  private buildNoteFromExtraction(extraction: PolicyExtraction, fileName: string): string {
    const parts = [
      `Póliza procesada desde: ${fileName}`,
      extraction.policyNumber ? `Número de póliza: ${extraction.policyNumber}` : null,
      extraction.carrierName ? `Aseguradora: ${extraction.carrierName}` : null,
      extraction.holderName ? `Titular: ${extraction.holderName}` : null,
      extraction.sumInsured ? `Suma asegurada: ${extraction.currency ?? "MXN"} ${extraction.sumInsured}` : null,
      extraction.premium ? `Prima: ${extraction.currency ?? "MXN"} ${extraction.premium}` : null,
      extraction.startDate ? `Vigencia: ${extraction.startDate} al ${extraction.endDate}` : null,
      extraction.renewalDate ? `Renovación: ${extraction.renewalDate}` : null,
      extraction.beneficiaries.length > 0
        ? `Beneficiarios: ${extraction.beneficiaries.map((b) => `${b.fullName} (${b.percentage ?? "?"}%)`).join(", ")}`
        : null,
      extraction.notes ?? null,
    ].filter(Boolean);

    return parts.join(". ");
  }
}
