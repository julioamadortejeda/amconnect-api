import { z } from "zod";
import { SkillDefinition, SkillContext } from "./skill.core.ts";
import { assertNoDuplicatePolicyNumber, resolveCatalogId } from "../../../shared/utils.ts";
import { buildChangelogContent, buildCoveragesNote, diffPolicy, PolicyChange } from "../../document_processing/policy_diff.ts";
import type { PolicyExtraction } from "../../document_processing/policy_extraction.schema.ts";

const BeneficiarySchema = z.object({
  full_name: z.string(),
  relationship: z.string().optional().nullable(),
  percentage: z.number().optional().nullable(),
});

export const policyIngestionSkills: SkillDefinition[] = [
  {
    domain: "policy_ingestion",
    declaration: {
      name: "update_policy_ingestion",
      description: "Updates an existing policy with the newly extracted document data. Call ONLY when the advisor explicitly confirms they want to update. Replaces the old RAG note and creates a changelog entry.",
      schema: z.object({
        confirmed: z.boolean().describe("Must be true — the advisor confirmed they want to update the existing policy"),
      }),
    },
    async execute(args, ctx) {
      if (!args.confirmed) {
        const { agentId, sessionId, aiSessionService, embeddingsService } = ctx;
        const meta = await aiSessionService.getSessionMetadata(sessionId);
        const newNoteId = meta?.newNoteId as string | null ?? null;
        if (newNoteId) {
          await embeddingsService.softDeleteNoteById(agentId, newNoteId, 'user_rejected');
        }
        return { cancelled: true, message: "Update discarded by advisor. Existing policy remains unchanged." };
      }
      try {
        return await resolveAndUpdatePolicy(ctx);
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
  },
  {
    domain: "policy_ingestion",
    declaration: {
      name: "confirm_policy_ingestion",
      description: "Creates the policy in the system with the data extracted from the document. Call this skill ONLY when the user has explicitly confirmed. Automatically resolves carrier, branch, product, and contact by name.",
      schema: z.object({
        // snake_case (preferido) + camelCase (fallback — Gemini a veces usa el mismo case del JSON de extracción)
        carrier_name: z.string().optional(), carrierName: z.string().optional(),
        branch_name: z.string().optional(),  branchName: z.string().optional(),
        holder_name: z.string().optional(),  holderName: z.string().optional(),
        product_name: z.string().optional().nullable(),  productName: z.string().optional().nullable(),
        holder_rfc: z.string().optional().nullable(),    holderRfc: z.string().optional().nullable(),
        policy_number: z.string().optional().nullable(), policyNumber: z.string().optional().nullable(),
        premium: z.number().optional().nullable(),
        sum_insured: z.number().optional().nullable(),   sumInsured: z.number().optional().nullable(),
        currency: z.string().optional().nullable().describe("MXN or USD"),
        start_date: z.string().optional().nullable(),    startDate: z.string().optional().nullable(),
        end_date: z.string().optional().nullable(),      endDate: z.string().optional().nullable(),
        renewal_date: z.string().optional().nullable(),  renewalDate: z.string().optional().nullable(),
        next_payment_date: z.string().optional().nullable(), nextPaymentDate: z.string().optional().nullable(),
        payment_frequency: z.string().optional().nullable(), paymentFrequency: z.string().optional().nullable(),
        notes: z.string().optional().nullable(),
        deductible: z.string().optional().nullable(), global_deductible: z.string().optional().nullable(), globalDeductible: z.string().optional().nullable(),
        beneficiaries: z.array(BeneficiarySchema).optional().default([]),
      }),
    },
    async execute(args, ctx) {
      try {
        return await resolveAndCreatePolicy(args as PolicyIngestionArgs, ctx);
      } catch (e) {
        return { error: e instanceof Error ? e.message : String(e) };
      }
    },
  },
];

// deno-lint-ignore no-explicit-any
type PolicyIngestionArgs = Record<string, any>;

function field(args: PolicyIngestionArgs, snake: string, camel: string): string | null | undefined {
  return args[snake] ?? args[camel];
}

async function resolveAndCreatePolicy(args: PolicyIngestionArgs, ctx: SkillContext) {
  const {
    agentId, sessionId,
    policyService, embeddingsService, aiSessionService,
    reminderGenerationService, catalogServices,
  } = ctx;

  const carrierName     = field(args, "carrier_name", "carrierName");
  const branchName      = field(args, "branch_name", "branchName");
  const productName     = field(args, "product_name", "productName");
  const holderName      = field(args, "holder_name", "holderName");
  const holderRfc       = field(args, "holder_rfc", "holderRfc");
  const policyNumber    = field(args, "policy_number", "policyNumber");
  const currency        = args.currency ?? "MXN";
  const startDate       = field(args, "start_date", "startDate");
  const endDate         = field(args, "end_date", "endDate");
  const renewalDate     = field(args, "renewal_date", "renewalDate");
  const nextPaymentDate = field(args, "next_payment_date", "nextPaymentDate");
  const paymentFreq     = field(args, "payment_frequency", "paymentFrequency");
  const beneficiaries   = args.beneficiaries ?? [];

  if (!carrierName || !branchName || !holderName) {
    return { error: "Missing required data: carrier_name, branch_name, and holder_name are required." };
  }

  // Re-validar duplicados con el policy_number FINAL (puede diferir del extraído
  // originalmente si el asesor lo corrigió en el chat antes de confirmar).
  await assertNoDuplicatePolicyNumber(policyService, agentId, policyNumber);

  // ─── Leer documentMetadataId de la sesión ────────────────────────────────
  const sessionMetadata = await aiSessionService.getSessionMetadata(sessionId);
  const documentMetadataId = sessionMetadata?.documentMetadataId as string | null ?? null;

  // ─── Resolver carrier ─────────────────────────────────────────────────────
  const carrierId = await findOrCreateCatalogItem(
    catalogServices.carrierService, carrierName,
  );

  // ─── Resolver branch ──────────────────────────────────────────────────────
  const branchId = await findOrCreateCatalogItem(
    catalogServices.branchService, branchName,
    { code: branchName.toUpperCase().replace(/\s+/g, "_").slice(0, 20) },
  );

  // ─── Resolver product ─────────────────────────────────────────────────────
  const productId = await findOrCreateCatalogItem(
    catalogServices.productService,
    productName ?? `${carrierName} ${branchName}`,
    { carrierId, branchId },
  );

  // ─── Resolver contacto ───────────────────────────────────────────────────
  const contactId = await findOrCreateContact(ctx, holderName, holderRfc ?? null);

  // ─── Resolver catálogos globales ──────────────────────────────────────────
  const [statusRow, currencyRow, paymentFrequencyId] = await Promise.all([
    catalogServices.policyStatusService.getByCode("ACTIVE"),
    catalogServices.currencyService.getByCode(currency === "USD" ? "USD" : "MXN"),
    paymentFreq ? resolveCatalogId(catalogServices.paymentFrequencyService, paymentFreq, { key: "name", value: "Anual" }) : Promise.resolve(null),
  ]) as [{ id: string } | null, { id: string } | null, string | null];

  if (!statusRow?.id) throw new Error("Status ACTIVE not found in catalog.");
  if (!currencyRow?.id) throw new Error(`Currency ${currency} not found in catalog.`);

  // ─── Crear póliza ─────────────────────────────────────────────────────────
  const policy = await policyService.create({
    agentId,
    contactId,
    carrierId,
    branchId,
    productId,
    statusId: statusRow.id,
    currencyId: currencyRow.id,
    paymentFrequencyId: paymentFrequencyId || null,
    policyNumber: policyNumber ?? null,
    premium: args.premium ?? null,
    sumInsured: args.sum_insured ?? args.sumInsured ?? null,
    startDate: startDate ?? null,
    endDate: endDate ?? null,
    renewalDate: renewalDate ?? null,
    nextPaymentDate: nextPaymentDate ?? null,
    notes: args.notes ?? null,
    deductible: args.deductible ?? args.global_deductible ?? args.globalDeductible ?? null,
  });

  if (!policy) throw new Error("Could not create policy.");

  // ─── Agregar beneficiarios ────────────────────────────────────────────────
  if (beneficiaries.length > 0) {
    await Promise.all(
      beneficiaries.map((b: { full_name: string; relationship?: string | null; percentage?: number | null }) =>
        policyService.addBeneficiary({
          policyId: policy.id,
          fullName: b.full_name,
          relationship: b.relationship ?? null,
          percentage: b.percentage ?? null,
        })
      ),
    );
  }

  // ─── Vincular notas al contacto y póliza confirmados ─────────────────────
  if (documentMetadataId) {
    await embeddingsService.updateNoteLinks(agentId, documentMetadataId, contactId, policy.id);
  }

  // ─── Generar recordatorios automáticos ───────────────────────────────────
  const reminders = await reminderGenerationService.generateForPolicy(policy, agentId, ctx.timezoneOffset);

  const fieldCount = [
    carrierName, branchName, holderName, productName,
    policyNumber, startDate, endDate, renewalDate, nextPaymentDate,
    args.premium, args.sum_insured ?? args.sumInsured, paymentFreq, args.notes,
  ].filter((v) => v !== null && v !== undefined && v !== "").length;

  return {
    success: true,
    policyId: policy.id,
    policyNumber: policy.policyNumber,
    message: "Policy created successfully.",
    __skillMetadata: {
      type: "policy_confirmed",
      policyId: policy.id,
      policyNumber: policy.policyNumber,
      carrierName,
      branchName,
      holderName,
      fieldCount,
      reminders,
    },
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// deno-lint-ignore no-explicit-any
async function findOrCreateCatalogItem(service: any, name: string, extra: Record<string, unknown> = {}): Promise<string> {
  const results = await service.search(name);
  if (results?.[0]?.id) return results[0].id as string;
  const created = await service.create({ name, ...extra });
  if (!created?.id) throw new Error(`Could not create catalog item: ${name}`);
  return created.id as string;
}

async function findOrCreateContact(ctx: SkillContext, fullName: string, rfc: string | null): Promise<string> {
  const { agentId, contactService } = ctx;

  if (rfc) {
    const byRfc = await contactService.getByField("rfc", rfc, 1);
    if (byRfc?.[0]?.id) return byRfc[0].id;
  }

  const similar = await contactService.findSimilarContact(agentId, fullName);
  if (similar?.[0]?.id) return similar[0].id;

  const created = await contactService.create({ agentId, fullName, rfc });
  if (!created?.id) throw new Error(`Could not create contact: ${fullName}`);
  return created.id;
}

async function resolveAndUpdatePolicy(ctx: SkillContext) {
  const { agentId, sessionId, policyService, embeddingsService, aiSessionService, catalogServices } = ctx;

  const meta = await aiSessionService.getSessionMetadata(sessionId);
  if (!meta?.existingPolicyId || !meta?.extraction) {
    return { error: "No update data found in session. Please start a new ingestion." };
  }

  const existingPolicyId = meta.existingPolicyId as string;
  const newDocumentMetadataId = meta.newDocumentMetadataId as string | null ?? null;
  const diff = (meta.diff ?? []) as PolicyChange[];
  const extraction = meta.extraction as PolicyExtraction;

  const carrierName = extraction.carrierName;
  const branchName = extraction.branchName;
  const productName = extraction.productName;
  const currency = extraction.currency ?? "MXN";
  const paymentFreq = extraction.paymentFrequency;

  if (!carrierName || !branchName) {
    return { error: "Missing carrier or branch in extraction data." };
  }

  const carrierId = await findOrCreateCatalogItem(catalogServices.carrierService, carrierName);
  const branchId = await findOrCreateCatalogItem(catalogServices.branchService, branchName, {
    code: branchName.toUpperCase().replace(/\s+/g, "_").slice(0, 20),
  });
  const productId = await findOrCreateCatalogItem(
    catalogServices.productService,
    productName ?? `${carrierName} ${branchName}`,
    { carrierId, branchId },
  );

  const [statusRow, currencyRow, paymentFrequencyId] = await Promise.all([
    catalogServices.policyStatusService.getByCode("ACTIVE"),
    catalogServices.currencyService.getByCode(currency === "USD" ? "USD" : "MXN"),
    paymentFreq ? resolveCatalogId(catalogServices.paymentFrequencyService, paymentFreq, { key: "name", value: "Anual" }) : Promise.resolve(null),
  ]) as [{ id: string } | null, { id: string } | null, string | null];

  if (!statusRow?.id) throw new Error("Status ACTIVE not found in catalog.");
  if (!currencyRow?.id) throw new Error(`Currency ${currency} not found in catalog.`);

  const updated = await policyService.update(existingPolicyId, {
    productId,
    statusId: statusRow.id,
    currencyId: currencyRow.id,
    paymentFrequencyId: paymentFrequencyId ?? null,
    policyNumber: extraction.policyNumber ?? undefined,
    premium: extraction.premium ?? undefined,
    sumInsured: extraction.sumInsured ?? undefined,
    startDate: extraction.startDate ?? undefined,
    endDate: extraction.endDate ?? undefined,
    renewalDate: extraction.renewalDate ?? undefined,
    nextPaymentDate: extraction.nextPaymentDate ?? undefined,
    notes: extraction.notes ?? undefined,
    deductible: extraction.globalDeductible ?? undefined,
  });

  if (!updated) throw new Error("Could not update policy.");

  // Soft-delete old policy note, then link the new one (already created during extract)
  await embeddingsService.softDeleteNotesByPolicy(agentId, existingPolicyId, 'policy');
  if (newDocumentMetadataId) {
    await embeddingsService.updateNoteLinks(agentId, newDocumentMetadataId, updated.contactId, existingPolicyId);
  }

  // Create changelog note
  const changelogContent = buildChangelogContent(
    extraction.policyNumber ?? 'N/A',
    diff,
    extraction.summary ?? '',
  );

  const { embeddingTotalTokens: changelogEmbTokens, embeddingCount: changelogEmbCount } =
    await embeddingsService.saveDocument(agentId, {
      content: changelogContent,
      sourceType: 'text',
      contactId: updated.contactId ?? null,
      policyId: existingPolicyId,
      noteOrigin: 'policy_changelog',
      summary: `Policy ${extraction.policyNumber ?? 'N/A'} updated — ${diff.length} field(s) changed.`,
    });

  await aiSessionService.trackEmbeddingUsageOnly(
    agentId, sessionId, null,
    embeddingsService.embeddingModelName,
    changelogEmbTokens,
    changelogEmbCount,
  );

  // Re-run diff against the now-updated policy to confirm changes saved
  const existingForDiff = await policyService.getById(existingPolicyId);
  const finalDiff = existingForDiff ? diffPolicy(existingForDiff, extraction) : diff;

  return {
    success: true,
    policyId: existingPolicyId,
    policyNumber: updated.policyNumber,
    message: "Policy updated successfully.",
    changesApplied: diff.length,
    __skillMetadata: {
      type: "policy_updated",
      policyId: existingPolicyId,
      policyNumber: updated.policyNumber,
      changesApplied: diff.length,
      remainingDifferences: finalDiff.length,
    },
  };
}
