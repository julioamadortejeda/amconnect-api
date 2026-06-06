import { z } from "zod";
import { createClient } from "@supabase/supabase-js";
import { SkillDefinition, SkillContext } from "./skill.core.ts";

async function logSkillError(agentId: string, message: string, stack?: string, meta?: Record<string, unknown>) {
  try {
    const supabase = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    await supabase.from("error_logs").insert({
      agent_id: agentId,
      error_type: "SkillError",
      status_code: 500,
      error_message: message,
      stack_trace: stack ?? null,
      request_path: "/skill/confirm_policy_ingestion",
      request_method: "SKILL",
      metadata: meta ?? null,
    });
  } catch {
    // silencioso — no podemos hacer nada más
  }
}

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
        const msg = e instanceof Error ? e.message : String(e);
        await logSkillError(ctx.agentId, msg, e instanceof Error ? e.stack : undefined, {
          args: { carrier: (args as PolicyIngestionArgs).carrier_name, holder: (args as PolicyIngestionArgs).holder_name },
          sessionId: ctx.sessionId,
        });
        return { error: msg };
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
  const { supabase, agentId, sessionId } = ctx;

  const carrierName   = field(args, "carrier_name", "carrierName");
  const branchName    = field(args, "branch_name", "branchName");
  const productName   = field(args, "product_name", "productName");
  const holderName    = field(args, "holder_name", "holderName");
  const holderRfc     = field(args, "holder_rfc", "holderRfc");
  const policyNumber  = field(args, "policy_number", "policyNumber");
  const currency      = args.currency ?? "MXN";
  const startDate     = field(args, "start_date", "startDate");
  const endDate       = field(args, "end_date", "endDate");
  const renewalDate   = field(args, "renewal_date", "renewalDate");
  const nextPaymentDate = field(args, "next_payment_date", "nextPaymentDate");
  const paymentFreq   = field(args, "payment_frequency", "paymentFrequency");
  const beneficiaries = args.beneficiaries ?? [];

  if (!carrierName || !branchName || !holderName) {
    return { error: "Faltan datos requeridos: carrier_name, branch_name y holder_name son obligatorios." };
  }

  // ─── Leer metadatos de la sesión ──────────────────────────────────────────
  const { data: session } = await supabase
    .from("ai_sessions")
    .select("metadata")
    .eq("id", sessionId)
    .single();

  const documentMetadataId = session?.metadata?.documentMetadataId as string | null ?? null;

  // ─── Resolver carrier ─────────────────────────────────────────────────────
  const carrierId = await findOrCreateCarrier(supabase, agentId, carrierName);

  // ─── Resolver branch ──────────────────────────────────────────────────────
  const branchId = await findOrCreateBranch(supabase, agentId, branchName);

  // ─── Resolver product ─────────────────────────────────────────────────────
  const productId = await findOrCreateProduct(
    supabase, agentId,
    productName ?? `${carrierName} ${branchName}`,
    carrierId, branchId,
  );

  // ─── Resolver contact ─────────────────────────────────────────────────────
  const contactId = await findOrCreateContact(supabase, agentId, holderName, holderRfc);

  // ─── Resolver catálogos globales ──────────────────────────────────────────
  const [statusId, currencyId, paymentFrequencyId] = await Promise.all([
    getCatalogId(supabase, "policy_statuses", "ACTIVE"),
    getCatalogId(supabase, "currencies", currency === "USD" ? "USD" : "MXN"),
    paymentFreq ? getPaymentFrequencyId(supabase, paymentFreq) : Promise.resolve(null),
  ]);

  // ─── Crear póliza ─────────────────────────────────────────────────────────
  const { data: policy, error: policyError } = await supabase
    .from("policies")
    .insert({
      agent_id: agentId,
      contact_id: contactId,
      product_id: productId,
      status_id: statusId,
      currency_id: currencyId,
      payment_frequency_id: paymentFrequencyId,
      policy_number: policyNumber ?? null,
      premium: args.premium ?? null,
      sum_insured: args.sum_insured ?? args.sumInsured ?? null,
      start_date: startDate ?? null,
      end_date: endDate ?? null,
      renewal_date: renewalDate ?? null,
      next_payment_date: nextPaymentDate ?? null,
      notes: args.notes ?? null,
    })
    .select()
    .single();

  if (policyError || !policy) {
    throw new Error(`No se pudo crear la póliza: ${policyError?.message ?? "sin datos"}`);
  }

  // ─── Agregar beneficiarios ────────────────────────────────────────────────
  if (beneficiaries.length > 0) {
    await supabase.from("policy_beneficiaries").insert(
      beneficiaries.map((b: { full_name: string; relationship?: string | null; percentage?: number | null }) => ({
        policy_id: policy.id,
        full_name: b.full_name,
        relationship: b.relationship ?? null,
        percentage: b.percentage ?? null,
      })),
    );
  }

  // ─── Vincular nota a la póliza y contacto confirmados ────────────────────
  if (documentMetadataId) {
    await supabase
      .from("agent_notes")
      .update({ contact_id: contactId, policy_id: policy.id })
      .eq("document_metadata_id", documentMetadataId)
      .eq("agent_id", agentId);
  }

  return {
    success: true,
    policyId: policy.id,
    policyNumber: policy.policy_number,
    message: "Póliza creada exitosamente.",
  };
}

// ─── Helpers ─────────────────────────────────────────────────────────────────

// Busca por proximidad trigram (search_catalog RPC). Si no hay match, crea el registro.
async function searchCatalog(
  supabase: SkillContext["supabase"],
  table: string,
  name: string,
  agentId: string,
  threshold = 0.2,
): Promise<string | null> {
  const { data } = await supabase.rpc("search_catalog", {
    p_table_name: table,
    p_query: name,
    p_threshold: threshold,
    p_agent_id: agentId,
  });
  return (data as Array<{ id: string }>)?.[0]?.id ?? null;
}

async function findOrCreateCarrier(supabase: SkillContext["supabase"], agentId: string, name: string): Promise<string> {
  const id = await searchCatalog(supabase, "carriers", name, agentId);
  if (id) return id;

  const { data: created } = await supabase
    .from("carriers").insert({ agent_id: agentId, name, is_active: true }).select("id").single();
  return created!.id;
}

async function findOrCreateBranch(supabase: SkillContext["supabase"], agentId: string, name: string): Promise<string> {
  const id = await searchCatalog(supabase, "branches", name, agentId);
  if (id) return id;

  const code = name.toUpperCase().replace(/\s+/g, "_").slice(0, 20);
  const { data: created } = await supabase
    .from("branches").insert({ agent_id: agentId, name, code, is_active: true }).select("id").single();
  return created!.id;
}

async function findOrCreateProduct(
  supabase: SkillContext["supabase"], agentId: string, name: string, carrierId: string, branchId: string,
): Promise<string> {
  const id = await searchCatalog(supabase, "products", name, agentId);
  if (id) return id;

  const { data: created } = await supabase
    .from("products")
    .insert({ agent_id: agentId, name, carrier_id: carrierId, branch_id: branchId, is_active: true })
    .select("id").single();
  return created!.id;
}

async function findOrCreateContact(
  supabase: SkillContext["supabase"], agentId: string, fullName: string, rfc?: string | null,
): Promise<string> {
  if (rfc) {
    const { data } = await supabase
      .from("contacts").select("id").eq("agent_id", agentId).eq("rfc", rfc).limit(1).single();
    if (data?.id) return data.id;
  }

  const { data } = await supabase
    .from("contacts").select("id").eq("agent_id", agentId).ilike("full_name", `%${fullName}%`).limit(1).single();
  if (data?.id) return data.id;

  const { data: created } = await supabase
    .from("contacts")
    .insert({ agent_id: agentId, full_name: fullName, rfc: rfc ?? null, is_active: true })
    .select("id").single();
  return created!.id;
}

async function getCatalogId(supabase: SkillContext["supabase"], table: string, code: string): Promise<string> {
  const { data } = await supabase.from(table).select("id").eq("code", code).single();
  if (!data?.id) throw new Error(`No se encontró el catálogo ${table} con código ${code}.`);
  return data.id;
}

async function getPaymentFrequencyId(supabase: SkillContext["supabase"], frequency: string): Promise<string | null> {
  const normalized = frequency.toLowerCase();
  const keywordMap: Record<string, string> = {
    mensual: "MONTHLY", anual: "ANNUAL", semestral: "SEMIANNUAL",
    trimestral: "QUARTERLY", "único": "SINGLE",
  };
  const code = Object.entries(keywordMap).find(([k]) => normalized.includes(k))?.[1];
  if (!code) return null;

  const { data } = await supabase.from("payment_frequencies").select("id").eq("code", code).single();
  return data?.id ?? null;
}
