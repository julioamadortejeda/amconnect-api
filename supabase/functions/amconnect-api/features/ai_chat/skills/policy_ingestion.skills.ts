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
        carrier_name: z.string({ required_error: "Se requiere el nombre de la aseguradora" }),
        branch_name: z.string({ required_error: "Se requiere el nombre del ramo" }),
        product_name: z.string().optional().nullable(),
        holder_name: z.string({ required_error: "Se requiere el nombre del titular" }),
        holder_rfc: z.string().optional().nullable(),
        policy_number: z.string().optional().nullable(),
        premium: z.number().optional().nullable(),
        sum_insured: z.number().optional().nullable(),
        currency: z.string().optional().nullable().describe("MXN o USD"),
        start_date: z.string().optional().nullable(),
        end_date: z.string().optional().nullable(),
        renewal_date: z.string().optional().nullable(),
        next_payment_date: z.string().optional().nullable(),
        payment_frequency: z.string().optional().nullable(),
        notes: z.string().optional().nullable(),
        beneficiaries: z.array(BeneficiarySchema).optional().default([]),
      }),
    },
    async execute(args, ctx) {
      try {
        return await resolveAndCreatePolicy(args as PolicyIngestionArgs, ctx);
      } catch (e) {
        return { error: e instanceof Error ? e.message : "Error al crear la póliza." };
      }
    },
  },
];

interface PolicyIngestionArgs {
  carrier_name: string;
  branch_name: string;
  product_name?: string | null;
  holder_name: string;
  holder_rfc?: string | null;
  policy_number?: string | null;
  premium?: number | null;
  sum_insured?: number | null;
  currency?: string | null;
  start_date?: string | null;
  end_date?: string | null;
  renewal_date?: string | null;
  next_payment_date?: string | null;
  payment_frequency?: string | null;
  notes?: string | null;
  beneficiaries?: Array<{ full_name: string; relationship?: string | null; percentage?: number | null }>;
}

async function resolveAndCreatePolicy(args: PolicyIngestionArgs, ctx: SkillContext) {
  const { supabase, agentId, sessionId } = ctx;

  // ─── Leer metadatos de la sesión ──────────────────────────────────────────
  const { data: session } = await supabase
    .from("ai_sessions")
    .select("metadata")
    .eq("id", sessionId)
    .single();

  const documentMetadataId = session?.metadata?.documentMetadataId as string | null ?? null;

  // ─── Resolver carrier ─────────────────────────────────────────────────────
  const carrierId = await findOrCreateCarrier(supabase, agentId, args.carrier_name);

  // ─── Resolver branch ──────────────────────────────────────────────────────
  const branchId = await findOrCreateBranch(supabase, agentId, args.branch_name);

  // ─── Resolver product ─────────────────────────────────────────────────────
  const productId = await findOrCreateProduct(
    supabase, agentId,
    args.product_name ?? `${args.carrier_name} ${args.branch_name}`,
    carrierId, branchId,
  );

  // ─── Resolver contact ─────────────────────────────────────────────────────
  const contactId = await findOrCreateContact(supabase, agentId, args.holder_name, args.holder_rfc);

  // ─── Resolver catálogos globales ──────────────────────────────────────────
  const [statusId, currencyId, paymentFrequencyId] = await Promise.all([
    getCatalogId(supabase, "policy_statuses", "ACTIVE"),
    getCatalogId(supabase, "currencies", args.currency === "USD" ? "USD" : "MXN"),
    args.payment_frequency ? getPaymentFrequencyId(supabase, args.payment_frequency) : Promise.resolve(null),
  ]);

  // ─── Crear póliza ─────────────────────────────────────────────────────────
  const { data: policy, error: policyError } = await supabase
    .from("policies")
    .insert({
      agent_id: agentId,
      contact_id: contactId,
      carrier_id: carrierId,
      branch_id: branchId,
      product_id: productId,
      status_id: statusId,
      currency_id: currencyId,
      payment_frequency_id: paymentFrequencyId,
      policy_number: args.policy_number ?? null,
      premium: args.premium ?? null,
      sum_insured: args.sum_insured ?? null,
      start_date: args.start_date ?? null,
      end_date: args.end_date ?? null,
      renewal_date: args.renewal_date ?? null,
      next_payment_date: args.next_payment_date ?? null,
      notes: args.notes ?? null,
    })
    .select()
    .single();

  if (policyError || !policy) throw new Error("No se pudo crear la póliza en la base de datos.");

  // ─── Agregar beneficiarios ────────────────────────────────────────────────
  if (args.beneficiaries && args.beneficiaries.length > 0) {
    await supabase.from("policy_beneficiaries").insert(
      args.beneficiaries.map((b) => ({
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
