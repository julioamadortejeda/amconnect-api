import { z } from "zod";
import { SkillDefinition } from "./skill.core.ts";
import { PolicyResponseDTO } from "../../../modules/policy/policy.dto.ts";
import { appendNote, resolveCatalogId } from "../../../shared/utils.ts";

const slimPolicy = (p: PolicyResponseDTO) => ({
  id: p.id,
  policyNumber: p.policyNumber,
  contact: p.contact,
  premium: p.premium,
  sumInsured: p.sumInsured,
  startDate: p.startDate,
  endDate: p.endDate,
  renewalDate: p.renewalDate,
  nextPaymentDate: p.nextPaymentDate,
  notes: p.notes,
  product: p.product,
  status: p.status,
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
      return (policies ?? []).map(slimPolicy);
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
      return (policies ?? []).map(slimPolicy);
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
      return { policy, participants, beneficiaries };
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
      });
    },
  },
  {
    domain: "policy",
    declaration: {
      name: "create_policy",
      description: "Creates a new insurance policy manually for the advisor. Requires contact_id and product_id. You can pass friendly names for status (e.g., 'Vigente'), currency (e.g., 'MXN', 'USD'), payment_frequency (e.g., 'Anual', 'Mensual') and they will be resolved automatically.",
      schema: z.object({
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
      }),
    },
    async execute(args, ctx) {
      const params = args as any;
      const statusId = await resolveCatalogId(ctx.catalogServices.policyStatusService, params.status, { key: "code", value: "VIGENTE" });
      const currencyId = await resolveCatalogId(ctx.catalogServices.currencyService, params.currency, { key: "code", value: "MXN" });
      const paymentFrequencyId = params.payment_frequency 
        ? await resolveCatalogId(ctx.catalogServices.paymentFrequencyService, params.payment_frequency, { key: "name", value: "Anual" })
        : null;
      const paymentMethodId = params.payment_method
        ? await resolveCatalogId(ctx.catalogServices.paymentMethodService, params.payment_method, { key: "name", value: "Tarjeta de Crédito" })
        : null;

      const policy = await ctx.policyService.create({
        agentId: ctx.agentId,
        contactId: params.contact_id,
        productId: params.product_id,
        statusId,
        currencyId,
        paymentFrequencyId,
        paymentMethodId,
        policyNumber: params.policy_number,
        sumInsured: params.sum_insured,
        premium: params.premium,
        startDate: params.start_date,
        endDate: params.end_date,
        renewalDate: params.renewal_date,
        nextPaymentDate: params.next_payment_date,
        notes: params.notes,
      });

      return policy ? slimPolicy(policy) : null;
    },
  },
  {
    domain: "policy",
    declaration: {
      name: "update_policy",
      description: "Modifies the data of an existing policy. Requires policy_id.",
      schema: z.object({
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
      }),
    },
    async execute(args, ctx) {
      const params = args as any;
      const updates: Record<string, unknown> = { ...params };
      delete updates.policy_id;
      delete updates.status;
      delete updates.currency;
      delete updates.payment_frequency;
      delete updates.payment_method;

      if (params.status) {
        updates.statusId = await resolveCatalogId(ctx.catalogServices.policyStatusService, params.status, { key: "code", value: "VIGENTE" });
      }
      if (params.currency) {
        updates.currencyId = await resolveCatalogId(ctx.catalogServices.currencyService, params.currency, { key: "code", value: "MXN" });
      }
      if (params.payment_frequency) {
        updates.paymentFrequencyId = await resolveCatalogId(ctx.catalogServices.paymentFrequencyService, params.payment_frequency, { key: "name", value: "Anual" });
      }
      if (params.payment_method) {
        updates.paymentMethodId = await resolveCatalogId(ctx.catalogServices.paymentMethodService, params.payment_method, { key: "name", value: "Tarjeta de Crédito" });
      }

      if (params.notes) {
        const existing = await ctx.policyService.getById(params.policy_id);
        updates.notes = appendNote(existing?.notes, params.notes);
      }

      const result = await ctx.policyService.update(params.policy_id, updates as never);
      return result ? slimPolicy(result) : null;
    },
  },
  {
    domain: "policy",
    declaration: {
      name: "get_expiring_policies",
      description: "Retrieves policies that are about to expire or renew in the coming days (defaults to the next 30 days).",
      schema: z.object({
        days: z.number().optional().describe("Days in the future to search for expirations (default: 30)"),
      }),
    },
    async execute({ days }, ctx) {
      const items = await ctx.policyService.getUpcomingExpirations(ctx.agentId, (days as number) ?? 30);
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
      const policies = await ctx.policyService.getByField("agent_id", ctx.agentId);
      if (!policies || policies.length === 0) {
        return { totalPolicies: 0, message: "You have no policies in your portfolio." };
      }

      const statusCounts: Record<string, number> = {};
      const branchCounts: Record<string, number> = {};
      const premiumSums: Record<string, number> = {};

      for (const p of policies) {
        const statusName = p.status?.name || "Unknown";
        statusCounts[statusName] = (statusCounts[statusName] || 0) + 1;

        const branchName = p.product?.branch?.name || "Unknown";
        branchCounts[branchName] = (branchCounts[branchName] || 0) + 1;

        if (p.premium) {
          const currencyCode = p.currency?.code || "MXN";
          premiumSums[currencyCode] = (premiumSums[currencyCode] || 0) + p.premium;
        }
      }

      return {
        totalPolicies: policies.length,
        statusBreakdown: statusCounts,
        branchBreakdown: branchCounts,
        premiumSummaries: premiumSums,
      };
    },
  },
  {
    domain: "policy",
    declaration: {
      name: "search_policies",
      description: "Searches for policies in the advisor's portfolio by text matching. If the user mentions a client's name in their request, you must first search for the client using search_contact to get their contact_id and pass it in the contact_id parameter of this function, using the query parameter only to filter by branch, product, or policy number (e.g., 'auto', 'GNP').",
      schema: z.object({
        query: z.string({ required_error: "Search text" }).describe("Text to search for (e.g., 'auto', 'GNP', policy number)"),
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
        policy_query: z.string().optional().describe("Text to identify the policy (e.g., 'auto', 'GNP', 'Vida'). If omitted, returns all policies of the client."),
      }),
    },
    async execute({ client_name, policy_query }, ctx) {
      const contacts = await ctx.contactService.findSimilarContact(ctx.agentId, client_name as string);
      if (!contacts || contacts.length === 0) {
        return { error: `No client found matching '${client_name}'.` };
      }
      const allPolicies: PolicyResponseDTO[] = [];
      for (const contact of contacts) {
        const policies = policy_query
          ? await ctx.policyService.searchPolicies(ctx.agentId, policy_query as string, contact.id)
          : await ctx.policyService.getByField("contact_id", contact.id);
        if (policies) allPolicies.push(...policies);
      }
      return allPolicies.map(slimPolicy);
    },
  },
];
