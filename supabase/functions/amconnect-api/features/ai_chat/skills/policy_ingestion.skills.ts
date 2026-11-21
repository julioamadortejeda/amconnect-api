import { z } from "zod";
import { SkillDefinition } from "./skill.core.ts";
import type { PolicyConfirmationInput } from "../../document_processing/policy_confirmation.service.ts";
import { policyConfirmedResult, policyUpdatedResult } from "./policy_ingestion.mapper.ts";

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
        await ctx.policyConfirmation.discardUpdate(ctx.agentId, ctx.sessionId);
        return { cancelled: true, message: "Update discarded by advisor. Existing policy remains unchanged." };
      }
      try {
        return policyUpdatedResult(await ctx.policyConfirmation.applyUpdate(ctx.agentId, ctx.sessionId));
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
        payment_method: z.string().optional().nullable(), paymentMethod: z.string().optional().nullable(),
        notes: z.string().optional().nullable(),
        deductible: z.string().optional().nullable(), global_deductible: z.string().optional().nullable(), globalDeductible: z.string().optional().nullable(),
        coinsurance: z.string().optional().nullable(), global_coinsurance: z.string().optional().nullable(), globalCoinsurance: z.string().optional().nullable(),
        seniority_date: z.string().optional().nullable(), seniorityDate: z.string().optional().nullable(),
        insured_item: z.string().optional().nullable(), insuredItem: z.string().optional().nullable(),
        policy_version: z.string().optional().nullable(), policyVersion: z.string().optional().nullable(),
        beneficiaries: z.array(BeneficiarySchema).optional().default([]),
      }),
    },
    async execute(args, ctx) {
      try {
        const result = await ctx.policyConfirmation.confirm(
          ctx.agentId,
          ctx.sessionId,
          ctx.timezoneOffset,
          toConfirmationInput(args as PolicyIngestionArgs),
        );
        return policyConfirmedResult(result);
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

/**
 * Junta las variantes de nombre de campo que manda el modelo (snake_case
 * preferido, camelCase de respaldo, `global_*` de la extracción) en un solo
 * input para el service.
 */
function toConfirmationInput(args: PolicyIngestionArgs): PolicyConfirmationInput {
  return {
    carrierName: field(args, "carrier_name", "carrierName"),
    branchName: field(args, "branch_name", "branchName"),
    productName: field(args, "product_name", "productName"),
    holderName: field(args, "holder_name", "holderName"),
    holderRfc: field(args, "holder_rfc", "holderRfc"),
    policyNumber: field(args, "policy_number", "policyNumber"),
    currency: args.currency,
    premium: args.premium,
    sumInsured: args.sum_insured ?? args.sumInsured,
    startDate: field(args, "start_date", "startDate"),
    endDate: field(args, "end_date", "endDate"),
    renewalDate: field(args, "renewal_date", "renewalDate"),
    nextPaymentDate: field(args, "next_payment_date", "nextPaymentDate"),
    paymentFrequency: field(args, "payment_frequency", "paymentFrequency"),
    paymentMethod: field(args, "payment_method", "paymentMethod"),
    notes: args.notes,
    deductible: args.deductible ?? args.global_deductible ?? args.globalDeductible,
    coinsurance: args.coinsurance ?? args.global_coinsurance ?? args.globalCoinsurance,
    seniorityDate: field(args, "seniority_date", "seniorityDate"),
    insuredItem: field(args, "insured_item", "insuredItem"),
    policyVersion: field(args, "policy_version", "policyVersion"),
    beneficiaries: args.beneficiaries ?? [],
  };
}
