import { IAiProvider } from "../../core/ai_provider.interface.ts";
import { IEmbeddingProvider } from "../../core/embedding_provider.interface.ts";
import { EmbeddingsService } from "../rag/embeddings.service.ts";
import { AiSessionService } from "../ai_chat/ai_session.service.ts";
import { StorageService } from "../../modules/storage/storage.service.ts";
import { DocumentMetadataRepository } from "../../modules/document_metadata/document_metadata.repository.ts";
import { AiInvokedError, AiProviderError, AppError, ConflictError } from "../../shared/errors.ts";
import { PolicyService } from "../../modules/policy/policy.service.ts";
import {
  POLICY_EXTRACTION_PROMPT,
  PolicyExtraction,
  PolicyExtractionSchema,
} from "./policy_extraction.schema.ts";

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
}

export class PolicyIngestionService {
  constructor(
    private documentMetadataRepository: DocumentMetadataRepository,
    private aiProvider: IAiProvider,
    private embeddingsService: EmbeddingsService,
    private embeddingProvider: IEmbeddingProvider,
    private aiSessionService: AiSessionService,
    private storageService: StorageService,
    private policyService: PolicyService,
  ) {}

  async extract(agentId: string, sessionId: string, input: PolicyIngestInput): Promise<PolicyIngestResult> {
    const { storagePath, fileName, mimeType, contactId } = input;

    // Download throws AppError (pre-AI) — controller will deleteSession on catch
    const base64 = await this.storageService.downloadAsBase64("policies", storagePath);

    // From this point forward, any error must be AiInvokedError so the controller
    // marks the session as failed instead of deleting it.
    let extraction: PolicyExtraction;
    let extractionUsage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined;
    try {
      const result = await this.aiProvider.generateStructuredData(
        POLICY_EXTRACTION_PROMPT,
        PolicyExtractionSchema,
        { mimeType, data: base64 },
      );
      extraction = result.data;
      extractionUsage = result.usage;
    } catch (err) {
      if (err instanceof AiProviderError) throw err;
      throw new AiInvokedError(
        `Error en la extracción de póliza con IA: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err : undefined,
      );
    }

    // Guard against duplicate before any DB writes. AI was already invoked so we track
    // extraction tokens and mark the session failed (not deleted) before throwing.
    if (extraction.policyNumber) {
      const existing = await this.policyService.findByFilters({
        agent_id: agentId,
        policy_number: extraction.policyNumber,
      }, 1);
      if (existing && existing.length > 0) {
        await this.aiSessionService.trackExtractionUsageOnly(
          agentId,
          sessionId,
          null,
          this.aiProvider.model,
          extractionUsage,
        );
        throw new ConflictError(
          `Ya existe una póliza con el número "${extraction.policyNumber}" en tu cartera.`,
        );
      }
    }

    try {
      const docMeta = await this.documentMetadataRepository.create({
        agent_id: agentId,
        file_name: fileName,
        storage_path: storagePath,
        mime_type: mimeType,
        ingestion_type: "pdf",
        raw_extraction: extraction as unknown as Record<string, unknown>,
        extracted_at: new Date().toISOString(),
      });

      if (!docMeta) throw new AppError("No se pudo guardar los metadatos del documento.", 500);

      const coveragesText = buildCoveragesNote(extraction);

      const [summaryResult, coveragesResult] = await Promise.all([
        this.embeddingsService.saveDocument(agentId, {
          content: extraction.summary,
          sourceType: "pdf",
          contactId: contactId ?? null,
          documentMetadataId: docMeta.id,
          metadata: { intent: "policy", fileName, documentMetadataId: docMeta.id },
        }),
        coveragesText
          ? this.embeddingsService.saveDocument(agentId, {
              content: coveragesText,
              sourceType: "pdf",
              contactId: contactId ?? null,
              documentMetadataId: docMeta.id,
              metadata: { intent: "policy_coverages", fileName, documentMetadataId: docMeta.id },
            })
          : null,
      ]);

      const noteId = summaryResult.noteId;
      const embeddingTotalTokens = summaryResult.embeddingTotalTokens + (coveragesResult?.embeddingTotalTokens ?? 0);
      const embeddingCount = summaryResult.embeddingCount + (coveragesResult?.embeddingCount ?? 0);

      // Registrar detalles de ingesta en la sesión unificada
      await this.aiSessionService.trackIngestionUsage(
        agentId,
        sessionId,
        docMeta.id,
        this.aiProvider.model,
        extractionUsage,
        this.embeddingProvider.model,
        embeddingTotalTokens,
        embeddingCount,
      );

      // Actualizar metadatos de la sesión
      await this.aiSessionService.updateMetadata(sessionId, {
        extraction,
        documentMetadataId: docMeta.id,
        noteId,
      });

      return {
        documentMetadataId: docMeta.id,
        noteId,
        extraction,
      };
    } catch (err) {
      if (err instanceof AppError) {
        throw new AiInvokedError(err.message, err);
      }
      throw new AiInvokedError(
        `Error post-extracción de póliza: ${err instanceof Error ? err.message : String(err)}`,
        err instanceof Error ? err : undefined,
      );
    }
  }
}

function buildCoveragesNote(extraction: PolicyExtraction): string | null {
  if (extraction.coverages.length === 0) return null;

  const header = [extraction.policyNumber, extraction.productName, extraction.carrierName]
    .filter(Boolean)
    .join(" – ");

  const lines = extraction.coverages.map((c) => {
    let line = `- ${c.name}`;
    if (c.description) line += `: ${c.description}`;
    if (c.amount != null) line += ` (${c.amount} ${extraction.currency ?? "MXN"})`;
    return line;
  });

  return `Coberturas de póliza ${header}:\n${lines.join("\n")}`;
}
