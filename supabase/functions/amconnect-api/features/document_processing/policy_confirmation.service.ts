import type { PolicyService } from "../../modules/policy/policy.service.ts";
import type { PolicyResponseDTO } from "../../modules/policy/policy.dto.ts";
import type { ContactService } from "../../modules/contact/contact.service.ts";
import type { CatalogServices } from "../../modules/catalog/catalog.service.ts";
import type { ReminderGenerationService } from "../../modules/reminder/reminder_generation.service.ts";
import type { EmbeddingsService } from "../rag/embeddings.service.ts";
import type { AiSessionService } from "../ai_chat/ai_session.service.ts";
import { assertNoDuplicatePolicyNumber, resolveCatalogId } from "../../shared/utils.ts";
import { buildChangelogContent, diffPolicy, type PolicyChange } from "./policy_diff.ts";
import type { PolicyExtraction } from "./policy_extraction.schema.ts";

type PolicyDeps = Pick<PolicyService, "create" | "update" | "getById" | "findByFilters" | "addBeneficiary">;
type ContactDeps = Pick<ContactService, "findMatchingContact" | "create">;
type EmbeddingsDeps = Pick<
  EmbeddingsService,
  "saveDocument" | "updateNoteLinks" | "softDeleteNoteById" | "softDeleteNotesByPolicy" | "embeddingModelName"
>;
type SessionDeps = Pick<AiSessionService, "getSessionMetadata" | "updateMetadata" | "trackEmbeddingUsageOnly">;
type ReminderGenerationDeps = Pick<ReminderGenerationService, "generateForPolicy">;
type GeneratedReminders = Awaited<ReturnType<ReminderGenerationService["generateForPolicy"]>>;

/** Lo que el asesor confirmó en el chat, ya sin variantes de nombre de campo. */
export interface PolicyConfirmationInput {
  carrierName?: string | null;
  branchName?: string | null;
  productName?: string | null;
  holderName?: string | null;
  holderRfc?: string | null;
  policyNumber?: string | null;
  /** MXN o USD; cualquier otra cosa se toma como MXN. */
  currency?: string | null;
  premium?: number | null;
  sumInsured?: number | null;
  startDate?: string | null;
  endDate?: string | null;
  renewalDate?: string | null;
  nextPaymentDate?: string | null;
  paymentFrequency?: string | null;
  paymentMethod?: string | null;
  notes?: string | null;
  deductible?: string | null;
  coinsurance?: string | null;
  seniorityDate?: string | null;
  insuredItem?: string | null;
  policyVersion?: string | null;
  beneficiaries: Array<{ full_name: string; relationship?: string | null; percentage?: number | null }>;
}

export type ConfirmPolicyResult =
  | { outcome: "missing_required" }
  | {
    outcome: "created";
    policy: PolicyResponseDTO;
    carrierName: string;
    branchName: string;
    holderName: string;
    /** Cuántos de los campos principales venían con valor. */
    fieldCount: number;
    reminders: GeneratedReminders;
  };

export type ApplyPolicyUpdateResult =
  | { outcome: "no_session_data" }
  | { outcome: "missing_carrier_or_branch" }
  | {
    outcome: "updated";
    policyId: string;
    policyNumber: string | null;
    carrierName: string;
    branchName: string;
    holderName: string | null | undefined;
    changesApplied: number;
    /** Diferencias que siguen tras releer la póliza ya actualizada. */
    remainingDifferences: number;
  };

// deno-lint-ignore no-explicit-any
type FindOrCreateCatalog = { search(name: string): Promise<any>; create(data: any): Promise<any> };

/**
 * Cierre de la ingesta de una póliza desde el chat: crear la póliza que el
 * asesor confirmó (catálogos y contacto resueltos por nombre, beneficiarios,
 * notas ligadas y recordatorios automáticos), o aplicar/descartar la
 * actualización de una póliza que ya existía.
 *
 * El estado de la ingesta vive en la metadata de la sesión de IA (lo deja
 * `PolicyIngestionService` al extraer).
 */
export class PolicyConfirmationService {
  constructor(
    private policyService: PolicyDeps,
    private contactService: ContactDeps,
    private catalogServices: CatalogServices,
    private embeddingsService: EmbeddingsDeps,
    private aiSessionService: SessionDeps,
    private reminderGenerationService: ReminderGenerationDeps,
  ) {}

  async confirm(
    agentId: string,
    sessionId: string,
    timezoneOffset: string,
    input: PolicyConfirmationInput,
  ): Promise<ConfirmPolicyResult> {
    const { carrierName, branchName, productName, holderName, policyNumber } = input;
    const currency = input.currency ?? "MXN";

    if (!carrierName || !branchName || !holderName) return { outcome: "missing_required" };

    // Re-validar duplicados con el policy_number FINAL (puede diferir del
    // extraído si el asesor lo corrigió en el chat antes de confirmar).
    await assertNoDuplicatePolicyNumber(this.policyService, agentId, policyNumber);

    const sessionMetadata = await this.aiSessionService.getSessionMetadata(sessionId);
    const documentMetadataId = sessionMetadata?.documentMetadataId as string | null ?? null;
    const finalContactId = sessionMetadata?.finalContactId as string | null ?? null;
    const contactMismatchAssignedToScreen = sessionMetadata?.contactMismatchAssignedToScreen === true;
    const mismatchDetectedContactName = sessionMetadata?.detectedContactName as string | null ?? null;

    const { carrierId, branchId, productId } = await this.resolveProduct(carrierName, branchName, productName);

    // `finalContactId` viene de la pantalla de origen (policy_ingestion.service.ts
    // extract()/resolveContactMismatch()): si está, ya se decidió —con o sin
    // conflicto— y no se vuelve a resolver por nombre/RFC.
    const contactId = finalContactId ?? await this.findOrCreateContact(agentId, holderName, input.holderRfc ?? null);

    const { statusId, currencyId, paymentFrequencyId, paymentMethodId } = await this.resolveGlobalCatalogs(
      currency,
      input.paymentFrequency,
      input.paymentMethod,
    );

    const policy = await this.policyService.create({
      agentId,
      contactId,
      carrierId,
      branchId,
      productId,
      statusId,
      currencyId,
      paymentFrequencyId: paymentFrequencyId || null,
      paymentMethodId: paymentMethodId || null,
      policyNumber: policyNumber ?? null,
      premium: input.premium ?? null,
      sumInsured: input.sumInsured ?? null,
      startDate: input.startDate ?? null,
      endDate: input.endDate ?? null,
      renewalDate: input.renewalDate ?? null,
      nextPaymentDate: input.nextPaymentDate ?? null,
      notes: input.notes ?? null,
      deductible: input.deductible ?? null,
      coinsurance: input.coinsurance ?? null,
      seniorityDate: input.seniorityDate ?? null,
      insuredItem: input.insuredItem ?? null,
      policyVersion: input.policyVersion ?? null,
    } as Parameters<PolicyDeps["create"]>[0]);

    if (!policy) throw new Error("Could not create policy.");

    // Nota de trazabilidad si el asesor forzó la asignación a otro contacto.
    if (contactMismatchAssignedToScreen && mismatchDetectedContactName) {
      const content =
        `This policy (${carrierName}${policyNumber ? ` #${policyNumber}` : ""}) was extracted from a document ` +
        `that identified "${mismatchDetectedContactName}" as the policyholder. The advisor chose to assign it to ` +
        `this client anyway on ${new Date().toISOString().slice(0, 10)}.`;
      const { embeddingTotalTokens, embeddingCount } = await this.embeddingsService.saveDocument(agentId, {
        content,
        sourceType: "text",
        contactId,
        policyId: policy.id,
        noteOrigin: "policy",
      });
      await this.aiSessionService.trackEmbeddingUsageOnly(
        agentId,
        sessionId,
        null,
        this.embeddingsService.embeddingModelName,
        embeddingTotalTokens,
        embeddingCount,
      );
    }

    if (input.beneficiaries.length > 0) {
      await Promise.all(
        input.beneficiaries.map((b) =>
          this.policyService.addBeneficiary({
            policyId: policy.id,
            fullName: b.full_name,
            relationship: b.relationship ?? null,
            percentage: b.percentage ?? null,
          })
        ),
      );
    }

    if (documentMetadataId) {
      await this.embeddingsService.updateNoteLinks(agentId, documentMetadataId, contactId, policy.id);
    }

    const reminders = await this.reminderGenerationService.generateForPolicy(
      policy as unknown as Parameters<ReminderGenerationDeps["generateForPolicy"]>[0],
      agentId,
      timezoneOffset,
    );

    const fieldCount = [
      carrierName, branchName, holderName, productName,
      policyNumber, input.startDate, input.endDate, input.renewalDate, input.nextPaymentDate,
      input.premium, input.sumInsured, input.paymentFrequency, input.notes,
    ].filter((v) => v !== null && v !== undefined && v !== "").length;

    return { outcome: "created", policy, carrierName, branchName, holderName, fieldCount, reminders };
  }

  /**
   * El asesor NO quiso actualizar la póliza existente: se descarta la nota que
   * se creó al extraer y la sesión queda resuelta, para que un /cancel
   * posterior no la vuelva a procesar (le pisaría el discard_reason con
   * 'session_cancelled').
   */
  async discardUpdate(agentId: string, sessionId: string): Promise<void> {
    const meta = await this.aiSessionService.getSessionMetadata(sessionId);
    const newNoteId = meta?.newNoteId as string | null ?? null;
    if (newNoteId) {
      await this.embeddingsService.softDeleteNoteById(agentId, newNoteId, "user_rejected");
    }
    await this.aiSessionService.updateMetadata(sessionId, { ...meta, status: "update_discarded" });
  }

  /** Aplica a la póliza existente lo extraído del documento nuevo. */
  async applyUpdate(agentId: string, sessionId: string): Promise<ApplyPolicyUpdateResult> {
    const meta = await this.aiSessionService.getSessionMetadata(sessionId);
    if (!meta?.existingPolicyId || !meta?.extraction) return { outcome: "no_session_data" };

    const existingPolicyId = meta.existingPolicyId as string;
    const newDocumentMetadataId = meta.newDocumentMetadataId as string | null ?? null;
    const diff = (meta.diff ?? []) as PolicyChange[];
    const extraction = meta.extraction as PolicyExtraction;

    const { carrierName, branchName, productName, holderName } = extraction;
    const currency = extraction.currency ?? "MXN";

    if (!carrierName || !branchName) return { outcome: "missing_carrier_or_branch" };

    const { productId } = await this.resolveProduct(carrierName, branchName, productName);
    const { statusId, currencyId, paymentFrequencyId, paymentMethodId } = await this.resolveGlobalCatalogs(
      currency,
      extraction.paymentFrequency,
      extraction.paymentMethod,
    );

    const updated = await this.policyService.update(existingPolicyId, {
      productId,
      statusId,
      currencyId,
      paymentFrequencyId: paymentFrequencyId ?? null,
      paymentMethodId: paymentMethodId ?? null,
      policyNumber: extraction.policyNumber ?? undefined,
      premium: extraction.premium ?? undefined,
      sumInsured: extraction.sumInsured ?? undefined,
      startDate: extraction.startDate ?? undefined,
      endDate: extraction.endDate ?? undefined,
      renewalDate: extraction.renewalDate ?? undefined,
      nextPaymentDate: extraction.nextPaymentDate ?? undefined,
      notes: extraction.notes ?? undefined,
      deductible: extraction.globalDeductible ?? undefined,
      coinsurance: extraction.globalCoinsurance ?? undefined,
      seniorityDate: extraction.seniorityDate ?? undefined,
      insuredItem: extraction.insuredItem ?? undefined,
      policyVersion: extraction.policyVersion ?? undefined,
    });

    if (!updated) throw new Error("Could not update policy.");

    // La nota vieja de la póliza se da de baja y se liga la nueva (ya creada
    // al extraer).
    await this.embeddingsService.softDeleteNotesByPolicy(agentId, existingPolicyId, "policy");
    if (newDocumentMetadataId) {
      await this.embeddingsService.updateNoteLinks(agentId, newDocumentMetadataId, updated.contactId, existingPolicyId);
    }

    // La decisión pendiente quedó resuelta: si el cliente llama /cancel después
    // (limpieza normal al cerrar el sheet o resetear el chat), el endpoint no
    // debe tratar la sesión como abandonada ni soft-borrar la nota recién
    // confirmada (updateMetadata REEMPLAZA la metadata — preservar el resto).
    await this.aiSessionService.updateMetadata(sessionId, { ...meta, status: "update_applied" });

    const changelogContent = buildChangelogContent(extraction.policyNumber ?? "N/A", diff, extraction.summary ?? "");
    const { embeddingTotalTokens, embeddingCount } = await this.embeddingsService.saveDocument(agentId, {
      content: changelogContent,
      sourceType: "text",
      contactId: updated.contactId ?? null,
      policyId: existingPolicyId,
      noteOrigin: "policy_changelog",
      summary: `Policy ${extraction.policyNumber ?? "N/A"} updated — ${diff.length} field(s) changed.`,
    });
    await this.aiSessionService.trackEmbeddingUsageOnly(
      agentId,
      sessionId,
      null,
      this.embeddingsService.embeddingModelName,
      embeddingTotalTokens,
      embeddingCount,
    );

    // Releer la póliza ya actualizada para confirmar que los cambios quedaron.
    const existingForDiff = await this.policyService.getById(existingPolicyId);
    const finalDiff = existingForDiff ? diffPolicy(existingForDiff, extraction) : diff;

    return {
      outcome: "updated",
      policyId: existingPolicyId,
      policyNumber: updated.policyNumber,
      carrierName,
      branchName,
      holderName,
      changesApplied: diff.length,
      remainingDifferences: finalDiff.length,
    };
  }

  // ─── Helpers ───────────────────────────────────────────────────────────────

  /** Aseguradora, ramo y producto por nombre; lo que no existe se crea. */
  private async resolveProduct(carrierName: string, branchName: string, productName: string | null | undefined) {
    const cat = this.catalogServices;
    const carrierId = await this.findOrCreateCatalogItem(cat.carrierService, carrierName);
    const branchId = await this.findOrCreateCatalogItem(cat.branchService, branchName, {
      code: branchName.toUpperCase().replace(/\s+/g, "_").slice(0, 20),
    });
    // El producto es del asesor y de UNA aseguradora/ramo: buscarlo solo por
    // nombre reutilizaba el de otra aseguradora con el mismo nombre.
    const resolvedProductName = productName ?? `${carrierName} ${branchName}`;
    const productId = await this.findOrCreateCatalogItem(
      {
        search: (name) => cat.productService.findByNameInCarrier(name, carrierId, branchId),
        create: (data) => cat.productService.create(data),
      },
      resolvedProductName,
      { carrierId, branchId },
    );
    return { carrierId, branchId, productId };
  }

  /** Estado ACTIVE, moneda (USD o MXN) y, si vienen, frecuencia y forma de pago. */
  private async resolveGlobalCatalogs(
    currency: string,
    paymentFrequency: string | null | undefined,
    paymentMethod: string | null | undefined,
  ) {
    const cat = this.catalogServices;
    const [statusRow, currencyRow, paymentFrequencyId, paymentMethodId] = await Promise.all([
      cat.policyStatusService.getByCode("ACTIVE"),
      cat.currencyService.getByCode(currency === "USD" ? "USD" : "MXN"),
      paymentFrequency
        ? resolveCatalogId(cat.paymentFrequencyService, paymentFrequency, { key: "name", value: "Anual" })
        : Promise.resolve(null),
      paymentMethod
        ? resolveCatalogId(cat.paymentMethodService, paymentMethod, { key: "code", value: "CREDIT_CARD" })
        : Promise.resolve(null),
    ]) as [{ id: string } | null, { id: string } | null, string | null, string | null];

    if (!statusRow?.id) throw new Error("Status ACTIVE not found in catalog.");
    if (!currencyRow?.id) throw new Error(`Currency ${currency} not found in catalog.`);
    return { statusId: statusRow.id, currencyId: currencyRow.id, paymentFrequencyId, paymentMethodId };
  }

  private async findOrCreateCatalogItem(
    service: FindOrCreateCatalog,
    name: string,
    extra: Record<string, unknown> = {},
  ): Promise<string> {
    const results = await service.search(name);
    if (results?.[0]?.id) return results[0].id as string;
    const created = await service.create({ name, ...extra });
    if (!created?.id) throw new Error(`Could not create catalog item: ${name}`);
    return created.id as string;
  }

  private async findOrCreateContact(agentId: string, fullName: string, rfc: string | null): Promise<string> {
    const match = await this.contactService.findMatchingContact(agentId, fullName, rfc);
    if (match) return match.id;
    const created = await this.contactService.create({ agentId, fullName, rfc });
    if (!created?.id) throw new Error(`Could not create contact: ${fullName}`);
    return created.id;
  }
}
