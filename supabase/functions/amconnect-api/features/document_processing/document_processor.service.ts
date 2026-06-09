import { IAiProvider } from "../../core/ai_provider.interface.ts";
import { StorageService } from "../../modules/storage/storage.service.ts";
import { DocumentMetadataRepository } from "../../modules/document_metadata/document_metadata.repository.ts";
import {
  POLICY_EXTRACTION_PROMPT,
  PolicyExtraction,
  PolicyExtractionSchema,
} from "./policy_extraction.schema.ts";
import { EmbeddingsService } from "../rag/embeddings.service.ts";

export class DocumentProcessorService {
  constructor(
    private storageService: StorageService,
    private documentMetadataRepository: DocumentMetadataRepository,
    private docAiProvider: IAiProvider,
    private embeddingsService: EmbeddingsService,
  ) {}

  async processDocument(
    agentId: string,
    storagePath: string,
    fileName: string,
  ): Promise<{ extraction: PolicyExtraction; documentMetadataId: string }> {
    const base64 = await this.storageService.downloadAsBase64("policies", storagePath);

    const { data: extraction } = await this.docAiProvider.generateStructuredData(
      POLICY_EXTRACTION_PROMPT,
      PolicyExtractionSchema,
      { mimeType: "application/pdf", data: base64 },
    );

    const docMeta = await this.documentMetadataRepository.create({
      agent_id: agentId,
      file_name: fileName,
      storage_path: storagePath,
      mime_type: "application/pdf",
      raw_extraction: extraction as unknown as Record<string, unknown>,
      extracted_at: new Date().toISOString(),
    });

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
