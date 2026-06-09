import { z } from "zod";
import { SkillDefinition, SkillContext } from "./skill.core.ts";

const BeneficiarySchema = z.object({
  full_name: z.string(),
  relationship: z.string().optional().nullable(),
  percentage: z.number().optional().nullable(),
});

export const policyIngestionSkills: SkillDefinition[] = [
  {
    domain: "policy_ingestion",
    declaration: {
      name: "confirm_policy_ingestion",
      description: "Crea la póliza en el sistema con los datos extraídos del documento. Llama este skill SOLO cuando el usuario haya confirmado explícitamente. Resuelve aseguradora, ramo, producto y contacto por nombre automáticamente.",
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
        currency: z.string().optional().nullable().describe("MXN o USD"),
        start_date: z.string().optional().nullable(),    startDate: z.string().optional().nullable(),
        end_date: z.string().optional().nullable(),      endDate: z.string().optional().nullable(),
        renewal_date: z.string().optional().nullable(),  renewalDate: z.string().optional().nullable(),
        next_payment_date: z.string().optional().nullable(), nextPaymentDate: z.string().optional().nullable(),
        payment_frequency: z.string().optional().nullable(), paymentFrequency: z.string().optional().nullable(),
        notes: z.string().optional().nullable(),
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
    contactService, policyService, embeddingsService, aiSessionService,
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
    return { error: "Faltan datos requeridos: carrier_name, branch_name y holder_name son obligatorios." };
  }

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
  const [statusRow, currencyRow, paymentFrequencyRow] = await Promise.all([
    catalogServices.policyStatusService.getByCode("ACTIVE"),
    catalogServices.currencyService.getByCode(currency === "USD" ? "USD" : "MXN"),
    paymentFreq ? resolvePaymentFrequency(catalogServices.paymentFrequencyService, paymentFreq) : null,
  ]);

  if (!statusRow?.id) throw new Error("No se encontró el estatus ACTIVE en el catálogo.");
  if (!currencyRow?.id) throw new Error(`No se encontró la moneda ${currency} en el catálogo.`);

  // ─── Crear póliza ─────────────────────────────────────────────────────────
  const policy = await policyService.create({
    agentId,
    contactId,
    carrierId,
    branchId,
    productId,
    statusId: statusRow.id as string,
    currencyId: currencyRow.id as string,
    paymentFrequencyId: (paymentFrequencyRow?.id as string) ?? null,
    policyNumber: policyNumber ?? null,
    premium: args.premium ?? null,
    sumInsured: args.sum_insured ?? args.sumInsured ?? null,
    startDate: startDate ?? null,
    endDate: endDate ?? null,
    renewalDate: renewalDate ?? null,
    nextPaymentDate: nextPaymentDate ?? null,
    notes: args.notes ?? null,
  });

  if (!policy) throw new Error("No se pudo crear la póliza.");

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
  const reminders = await reminderGenerationService.generateForPolicy(policy, agentId);

  const fieldCount = [
    carrierName, branchName, holderName, productName,
    policyNumber, startDate, endDate, renewalDate, nextPaymentDate,
    args.premium, args.sum_insured ?? args.sumInsured, paymentFreq, args.notes,
  ].filter((v) => v !== null && v !== undefined && v !== "").length;

  return {
    success: true,
    policyId: policy.id,
    policyNumber: policy.policyNumber,
    message: "Póliza creada exitosamente.",
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
  if (!created?.id) throw new Error(`No se pudo crear el registro de catálogo: ${name}`);
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
  if (!created?.id) throw new Error(`No se pudo crear el contacto: ${fullName}`);
  return created.id;
}

// deno-lint-ignore no-explicit-any
async function resolvePaymentFrequency(service: any, frequency: string): Promise<{ id: string } | null> {
  const normalized = frequency.toLowerCase();
  const keywordMap: Record<string, string> = {
    mensual: "MONTHLY", anual: "ANNUAL", semestral: "SEMIANNUAL",
    trimestral: "QUARTERLY", "único": "SINGLE",
  };
  const code = Object.entries(keywordMap).find(([k]) => normalized.includes(k))?.[1];
  if (!code) return null;
  return await service.getByCode(code);
}
