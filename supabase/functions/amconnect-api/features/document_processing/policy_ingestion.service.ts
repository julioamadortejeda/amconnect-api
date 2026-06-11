import { z } from "zod";
import { IAiProvider } from "../../core/ai_provider.interface.ts";
import { IEmbeddingProvider } from "../../core/embedding_provider.interface.ts";
import { EmbeddingsService } from "../rag/embeddings.service.ts";
import { AiSessionService } from "../ai_chat/ai_session.service.ts";
import { StorageService } from "../../modules/storage/storage.service.ts";
import { DocumentMetadataRepository } from "../../modules/document_metadata/document_metadata.repository.ts";
import { AiInvokedError, AiProviderError, AppError, ConflictError } from "../../shared/errors.ts";
import { PolicyService } from "../../modules/policy/policy.service.ts";
import {
  PolicyExtraction,
  PolicyExtractionSchema,
} from "./policy_extraction.schema.ts";
import { PromptService } from "../../modules/prompt/prompt.service.ts";

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
    // deno-lint-ignore no-explicit-any
    private catalogServices: any,
    private promptService: PromptService,
  ) {}

  async extract(agentId: string, sessionId: string, input: PolicyIngestInput): Promise<PolicyIngestResult> {
    const { storagePath, fileName, mimeType, contactId } = input;

    // Download throws AppError (pre-AI) — controller will deleteSession on catch
    const base64 = await this.storageService.downloadAsBase64("policies", storagePath);

    // Obtener los catálogos globales de base de datos de manera dinámica
    const [frequencies, methods, currencies] = await Promise.all([
      this.catalogServices.paymentFrequencyService.getAll(),
      this.catalogServices.paymentMethodService.getAll(),
      this.catalogServices.currencyService.getAll(),
    ]);

    // Extraer los códigos de catálogo
    const frequencyCodes = (frequencies || []).map((f: { code: string }) => f.code);
    const methodCodes = (methods || []).map((m: { code: string }) => m.code);
    const currencyCodes = (currencies || []).map((c: { code: string }) => c.code);

    // Construir el Zod Schema adaptado dinámicamente
    // Si no hay valores en base de datos, usamos fallbacks para que no falle z.enum
    const dynamicFrequencyEnum = frequencyCodes.length > 0
      ? z.enum(frequencyCodes as [string, ...string[]])
      : z.string();
    const dynamicMethodEnum = methodCodes.length > 0
      ? z.enum(methodCodes as [string, ...string[]])
      : z.string();
    const dynamicCurrencyEnum = currencyCodes.length > 0
      ? z.enum(currencyCodes as [string, ...string[]])
      : z.string();

    const dynamicSchema = PolicyExtractionSchema.extend({
      paymentFrequency: dynamicFrequencyEnum.nullable().describe(`Frecuencia de pago. Códigos válidos: ${frequencyCodes.join(", ") || "Cualquiera"}`),
      paymentMethod: dynamicMethodEnum.nullable().describe(`Forma de pago. Códigos válidos: ${methodCodes.join(", ") || "Cualquiera"}`),
      currency: dynamicCurrencyEnum.nullable().describe(`Moneda de la póliza. Códigos válidos: ${currencyCodes.join(", ") || "Cualquiera"}`),
    });

    const basePrompt = await this.promptService.getPrompt("policy_extraction_system");
    const dynamicPrompt = `
${basePrompt}

Use the following catalog values for matching fields:

1. paymentFrequency:
${(frequencies || []).map((f: { code: string; name: string }) => `   - ${f.code} (${f.name})`).join("\n")}

2. paymentMethod:
${(methods || []).map((m: { code: string; name: string }) => `   - ${m.code} (${m.name})`).join("\n")}

3. currency:
${(currencies || []).map((c: { code: string; name: string }) => `   - ${c.code} (${c.name})`).join("\n")}
`.trim();

    // From this point forward, any error must be AiInvokedError so the controller
    // marks the session as failed instead of deleting it.
    let extraction: PolicyExtraction;
    let extractionUsage: { promptTokens: number; completionTokens: number; totalTokens: number } | undefined;
    try {
      const result = await this.aiProvider.generateStructuredData(
        dynamicPrompt,
        dynamicSchema,
        { mimeType, data: base64 },
      );
      extraction = result.data as PolicyExtraction;
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
        raw_extraction: extraction,
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

  const lines = extraction.coverages.map((c: { name: string; amount: number | null; description: string | null }) => {
    let line = `- ${c.name}`;
    if (c.description) line += `: ${c.description}`;
    if (c.amount != null) line += ` (${c.amount} ${extraction.currency ?? "MXN"})`;
    return line;
  });

  return `Coberturas de póliza ${header}:\n${lines.join("\n")}`;
}
