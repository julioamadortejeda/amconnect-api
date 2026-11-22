import { z } from "zod";
import { todayInTimezone } from "../../../shared/datetime.ts";
import { nothingToUpdate, SkillDefinition } from "./skill.core.ts";
import { objectToCamelCase } from "../../../shared/case_converter.ts";
import { entityThreshold } from "../../rag/rag.service.ts";
import { policyDetailResult, policyListResult, portfolioStatsResult, slimPolicy } from "./policy.mapper.ts";

const CreatePolicySchema = z.object({
  contact_id: z.string({ required_error: "The contact/client UUID is required." }).uuid(),
  product_id: z.string({ required_error: "The product UUID is required." }).uuid(),
  policy_number: z.string().optional().describe("Policy number"),
  premium: z.number().optional().describe("Policy premium"),
  sum_insured: z.number().optional().describe("Sum insured"),
  start_date: z.string().optional().describe("Start date (YYYY-MM-DD)"),
  end_date: z.string().optional().describe("End date (YYYY-MM-DD)"),
  renewal_date: z.string().optional().describe("Renewal date (YYYY-MM-DD)"),
  next_payment_date: z.string().optional().describe("Next payment date (YYYY-MM-DD)"),
  status: z.string().optional().describe("Policy status (e.g., 'Vigente', 'Cancelada', 'Vencida'). Defaults to 'Vigente'"),
  currency: z.string().optional().describe("Policy currency (e.g., 'MXN', 'USD'). Defaults to 'MXN'"),
  payment_frequency: z.string().optional().describe("Payment frequency (e.g., 'Anual', 'Mensual', 'Semestral', 'Trimestral'). Defaults to 'Anual'"),
  payment_method: z.string().optional().describe("Payment method (e.g., 'Domiciliación', 'Transferencia Bancaria', 'Tarjeta de Crédito')"),
  notes: z.string().optional().describe("Additional notes"),
  deductible: z.string().optional().describe("Deductible (amount or percentage, e.g. '10%' or '$5,000')"),
  coinsurance: z.string().optional().describe("Coinsurance percentage (e.g. '10%'), common on GMM policies"),
  seniority_date: z.string().optional().describe("Recognized seniority date (antigüedad reconocida), YYYY-MM-DD — common on GMM/Life policies, distinct from start_date"),
  insured_item: z.string().optional().describe("Short label of the insured asset for Auto/Hogar/Mascotas policies (e.g. 'Suzuki Swift 2021 · ABC-123'). Leave empty for policies insuring a person."),
  policy_version: z.string().optional().describe("Policy version or endorsement number"),
});

const EXPIRING_MAX_SPAN_DAYS = 1830; // ~5 años

const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use YYYY-MM-DD").refine(
  (v) => {
    const d = new Date(`${v}T00:00:00Z`);
    return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === v;
  },
  "Not a real calendar date",
);

function addDays(date: string, days: number): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

const ExpiringPoliciesSchema = z.object({
  days: z.number().int().min(1).max(EXPIRING_MAX_SPAN_DAYS).optional()
    .describe("Days ahead of from_date (default: today) to search (default: 30). Ignored when to_date is given."),
  from_date: isoDate.optional().describe("Start of the window, YYYY-MM-DD in the advisor's local date (default: today)"),
  to_date: isoDate.optional().describe("End of the window, YYYY-MM-DD inclusive, must not be before from_date"),
});

// La regla entre campos (to >= from, tope de rango) vive en resolveExpiringRange:
// el esquema de una skill debe ser un ZodObject plano para declararse al modelo.
/** from/to efectivos en fecha local del asesor. Lanza si el rango queda al revés o excede el tope. */
export function resolveExpiringRange(
  args: z.infer<typeof ExpiringPoliciesSchema>,
  timezone: string,
  now: Date = new Date(),
): { from: string; to: string } {
  const from = args.from_date ?? todayInTimezone(timezone, now);
  const to = args.to_date ?? addDays(from, args.days ?? 30);
  if (to < from) throw new Error("to_date must be on or after from_date (from_date defaults to today)");
  if (addDays(from, EXPIRING_MAX_SPAN_DAYS) < to) throw new Error(`Range cannot exceed ${EXPIRING_MAX_SPAN_DAYS} days`);
  return { from, to };
}

const UpdatePolicySchema = z.object({
  policy_id: z.string({ required_error: "The UUID of the policy to update is required." }).uuid(),
  policy_number: z.string().optional(),
  premium: z.number().optional(),
  sum_insured: z.number().optional(),
  start_date: z.string().optional().describe("Date (YYYY-MM-DD)"),
  end_date: z.string().optional().describe("Date (YYYY-MM-DD)"),
  renewal_date: z.string().optional().describe("Date (YYYY-MM-DD)"),
  next_payment_date: z.string().optional().describe("Date (YYYY-MM-DD)"),
  status: z.string().optional().describe("New status (e.g., 'Vigente', 'Cancelada')"),
  currency: z.string().optional().describe("New currency (e.g., 'MXN', 'USD')"),
  payment_frequency: z.string().optional().describe("New payment frequency"),
  payment_method: z.string().optional().describe("New payment method"),
  notes: z.string().optional(),
  deductible: z.string().optional().describe("Deductible (amount or percentage, e.g. '10%' or '$5,000')"),
  coinsurance: z.string().optional().describe("Coinsurance percentage (e.g. '10%'), common on GMM policies"),
  seniority_date: z.string().optional().describe("Recognized seniority date (antigüedad reconocida), YYYY-MM-DD"),
  insured_item: z.string().optional().describe("Short label of the insured asset (Auto/Hogar/Mascotas)"),
  policy_version: z.string().optional().describe("Policy version or endorsement number"),
});

export const policySkills: SkillDefinition[] = [
  {
    domain: "policy",
    declaration: {
      name: "count_policies",
      description: "Counts how many policies the advisor has in their portfolio. Use when the user asks 'how many policies do I have?' or similar.",
      schema: z.object({}),
    },
    async execute(_args, ctx) {
      const count = await ctx.policyService.count({ agent_id: ctx.agentId });
      return { count };
    },
  },
  {
    domain: "policy",
    declaration: {
      name: "get_all_policies",
      description: "Retrieves all policies in the advisor's portfolio. Use when the user asks about 'my policies', 'all policies', payment dates, renewals, etc., without specifying a contact.",
      schema: z.object({}),
    },
    async execute(_args, ctx) {
      const policies = await ctx.policyService.getByField("agent_id", ctx.agentId);
      return policyListResult(policies);
    },
  },
  {
    domain: "policy",
    declaration: {
      name: "get_contact_policies",
      description: "Retrieves all policies of a contact.",
      schema: z.object({
        contact_id: z.string({ required_error: "The contact UUID is required" })
          .describe("UUID of the contact"),
      }),
    },
    async execute({ contact_id }, ctx) {
      const policies = await ctx.policyService.getByField("contact_id", contact_id as string);
      return policyListResult(policies);
    },
  },
  {
    domain: "policy",
    declaration: {
      name: "get_policy",
      description: "Retrieves the complete data of a policy by its ID, including beneficiaries and participants.",
      schema: z.object({
        policy_id: z.string({ required_error: "The policy UUID is required" })
          .describe("UUID of the policy"),
      }),
    },
    async execute({ policy_id }, ctx) {
      const [policy, participants, beneficiaries] = await Promise.all([
        ctx.policyService.getById(policy_id as string),
        ctx.policyService.getParticipants(policy_id as string),
        ctx.policyService.getBeneficiaries(policy_id as string),
      ]);
      return policyDetailResult(policy, participants, beneficiaries);
    },
  },
  {
    domain: "policy",
    declaration: {
      name: "search_policy_notes",
      description: "Searches for information about a policy in the saved notes (coverages, conditions, etc.).",
      schema: z.object({
        query: z.string({ required_error: "The search query is required" }),
        policy_id: z.string().optional().describe("UUID of the policy (optional)"),
      }),
    },
    async execute({ query, policy_id }, ctx) {
      return await ctx.ragService.searchNotes(ctx.agentId, query as string, {
        policyId: policy_id as string | undefined,
        threshold: entityThreshold(policy_id as string | undefined),
      });
    },
  },
  {
    domain: "policy",
    declaration: {
      name: "create_policy",
      description: "Creates a new insurance policy manually for the advisor. Requires contact_id and product_id. You can pass friendly names for status (e.g., 'Vigente'), currency (e.g., 'MXN', 'USD'), payment_frequency (e.g., 'Anual', 'Mensual') and they will be resolved automatically.",
      schema: CreatePolicySchema,
    },
    async execute(args, ctx) {
      const params = args as z.infer<typeof CreatePolicySchema>;
      const policy = await ctx.policyWorkflow.createByNames(ctx.agentId, {
        contactId: params.contact_id,
        productId: params.product_id,
        status: params.status,
        currency: params.currency,
        paymentFrequency: params.payment_frequency,
        paymentMethod: params.payment_method,
        policyNumber: params.policy_number,
        sumInsured: params.sum_insured,
        premium: params.premium,
        startDate: params.start_date,
        endDate: params.end_date,
        renewalDate: params.renewal_date,
        nextPaymentDate: params.next_payment_date,
        notes: params.notes,
        deductible: params.deductible,
        coinsurance: params.coinsurance,
        seniorityDate: params.seniority_date,
        insuredItem: params.insured_item,
        policyVersion: params.policy_version,
      });
      return policy ? slimPolicy(policy) : null;
    },
  },
  {
    domain: "policy",
    declaration: {
      name: "update_policy",
      description: "Modifies the data of an existing policy. Requires policy_id.",
      schema: UpdatePolicySchema,
    },
    async execute(args, ctx) {
      const params = args as z.infer<typeof UpdatePolicySchema>;
      // El modelo manda snake_case y prepareForUpdate lee camelCase: se convierte
      // el objeto COMPLETO de una vez. Mapear campo por campo ya había dejado
      // fuera las fechas y los montos — el update salía vacío y Supabase
      // respondía "sin filas", que el cliente traducía como 404.
      const fields: Record<string, unknown> = objectToCamelCase({ ...params });
      delete fields.policyId;
      const outcome = await ctx.policyWorkflow.updateByNames(params.policy_id, fields);
      if (outcome.outcome === "no_changes") throw nothingToUpdate();
      const result = outcome.policy;
      return result ? slimPolicy(result) : null;
    },
  },
  {
    domain: "policy",
    declaration: {
      name: "get_expiring_policies",
      description: "Lists the advisor's policies whose end date falls in a window, soonest first. For a calendar period ('next month', 'this year', 'in December', 'between March and May') resolve it to exact from_date/to_date (YYYY-MM-DD, inclusive) using today's date from the [CONTEXT] block — e.g. 'next month' = first to last day of that month. For 'in the next N days/weeks' just pass days. Use days alone, or from_date/to_date; with neither it returns the next 30 days. If only from_date is given the window is days (default 30) after it; if to_date is given it wins over days. Use this instead of listing every policy and filtering yourself.",
      schema: ExpiringPoliciesSchema,
    },
    async execute(args, ctx) {
      const { from, to } = resolveExpiringRange(args as z.infer<typeof ExpiringPoliciesSchema>, ctx.timezone);
      const items = await ctx.policyService.getExpiringBetween(ctx.agentId, from, to);
      return (items ?? []).map(slimPolicy);
    },
  },
  {
    domain: "policy",
    declaration: {
      name: "get_portfolio_stats",
      description: "Retrieves key aggregated portfolio statistics of the advisor (total policies, total premiums by currency, policies by branch, and policies by status).",
      schema: z.object({}),
    },
    async execute(_args, ctx) {
      return portfolioStatsResult(await ctx.policyWorkflow.getPortfolioStats(ctx.agentId));
    },
  },
  {
    domain: "policy",
    declaration: {
      name: "search_policies",
      description: "Searches the advisor's policies by free text. Matches every word in any field: policy number (partial ok), product, carrier, branch, insured item, policyholder name and notes; tolerates missing accents, typos and common synonyms (GMM, autos, SMNYL). Use contact_id when you already have it.",
      schema: z.object({
        query: z.string({ required_error: "Search text" }).describe("The advisor's own words, unchanged and untranslated (e.g., 'GMM de AXA', 'la del Jetta', 'auto de Pedro')."),
        contact_id: z.string().optional().describe("UUID of the contact to limit search (optional)"),
      }),
    },
    async execute({ query, contact_id }, ctx) {
      const items = await ctx.policyService.searchPolicies(ctx.agentId, query as string, contact_id as string | undefined);
      return (items ?? []).map(slimPolicy);
    },
  },
  {
    domain: "policy",
    declaration: {
      name: "find_policy_by_client",
      description: "Searches for policies by combining a client name and an optional policy criteria (e.g., branch 'auto', carrier 'GNP'). If 'policy_query' is omitted, it will return all policies of the client. Use when the user asks to perform an action or query about policies mentioning the client (e.g., 'update Karina's auto policy' or 'what policies does Juan have?'). This consolidates the search in a single step and saves tokens.",
      schema: z.object({
        client_name: z.string({ required_error: "Name of the client to search for (e.g., 'Karina', 'Juan')" }).describe("Name of the client"),
        policy_query: z.string().optional().describe("The advisor's own words for the policy, unchanged and untranslated (e.g., 'gastos médicos', 'la del Jetta'). Omit to return all of the client's policies."),
      }),
    },
    async execute({ client_name, policy_query }, ctx) {
      const result = await ctx.policyWorkflow.findByClientName(
        ctx.agentId,
        client_name as string,
        policy_query as string | undefined,
      );
      if (result.outcome === "no_client") {
        return { error: `No client found matching '${client_name}'.` };
      }
      return result.policies.map(slimPolicy);
    },
  },
];
