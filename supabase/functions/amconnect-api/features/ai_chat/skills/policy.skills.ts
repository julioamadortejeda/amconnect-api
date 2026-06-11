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
      description: "Cuenta cuántas pólizas tiene el asesor en su cartera. Usar cuando el usuario pregunta '¿cuántas pólizas tengo?' o similares.",
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
      description: "Obtiene todas las pólizas de la cartera del asesor. Usar cuando el usuario pregunta por 'mis pólizas', 'todas las pólizas', fechas de pago, renovaciones, etc. sin especificar un contacto.",
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
      description: "Obtiene todas las pólizas de un contacto.",
      schema: z.object({
        contact_id: z.string({ required_error: "Se requiere el UUID del contacto" })
          .describe("UUID del contacto"),
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
      description: "Obtiene los datos completos de una póliza por su ID, incluyendo beneficiarios y participantes.",
      schema: z.object({
        policy_id: z.string({ required_error: "Se requiere el UUID de la póliza" })
          .describe("UUID de la póliza"),
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
      description: "Busca información sobre una póliza en las notas guardadas (coberturas, condiciones, etc.).",
      schema: z.object({
        query: z.string({ required_error: "Se requiere el texto de búsqueda" }),
        policy_id: z.string().optional().describe("UUID de la póliza (opcional)"),
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
      description: "Crea una nueva póliza de seguro de forma manual para el asesor. Requiere contact_id y product_id. Puedes pasar nombres amigables para status (ej: 'Vigente'), currency (ej: 'MXN', 'USD'), payment_frequency (ej: 'Anual', 'Mensual') y se resolverán automáticamente.",
      schema: z.object({
        contact_id: z.string({ required_error: "Se requiere el UUID del contacto/cliente." }).uuid(),
        product_id: z.string({ required_error: "Se requiere el UUID del producto." }).uuid(),
        policy_number: z.string().optional().describe("Número de póliza"),
        premium: z.number().optional().describe("Prima de la póliza"),
        sum_insured: z.number().optional().describe("Suma asegurada"),
        start_date: z.string().optional().describe("Fecha de inicio (YYYY-MM-DD)"),
        end_date: z.string().optional().describe("Fecha de término (YYYY-MM-DD)"),
        renewal_date: z.string().optional().describe("Fecha de renovación (YYYY-MM-DD)"),
        next_payment_date: z.string().optional().describe("Fecha del próximo pago (YYYY-MM-DD)"),
        status: z.string().optional().describe("Estatus de la póliza (ej: 'Vigente', 'Cancelada', 'Vencida'). Por defecto 'Vigente'"),
        currency: z.string().optional().describe("Moneda de la póliza (ej: 'MXN', 'USD'). Por defecto 'MXN'"),
        payment_frequency: z.string().optional().describe("Frecuencia de pago (ej: 'Anual', 'Mensual', 'Semestral', 'Trimestral'). Por defecto 'Anual'"),
        payment_method: z.string().optional().describe("Método de pago (ej: 'Domiciliación', 'Transferencia Bancaria', 'Tarjeta de Crédito')"),
        notes: z.string().optional().describe("Notas adicionales"),
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
      description: "Modifica los datos de una póliza existente. Requiere policy_id.",
      schema: z.object({
        policy_id: z.string({ required_error: "Se requiere el UUID de la póliza a modificar." }).uuid(),
        policy_number: z.string().optional(),
        premium: z.number().optional(),
        sum_insured: z.number().optional(),
        start_date: z.string().optional().describe("Fecha (YYYY-MM-DD)"),
        end_date: z.string().optional().describe("Fecha (YYYY-MM-DD)"),
        renewal_date: z.string().optional().describe("Fecha (YYYY-MM-DD)"),
        next_payment_date: z.string().optional().describe("Fecha (YYYY-MM-DD)"),
        status: z.string().optional().describe("Nuevo estatus (ej: 'Vigente', 'Cancelada')"),
        currency: z.string().optional().describe("Nueva moneda (ej: 'MXN', 'USD')"),
        payment_frequency: z.string().optional().describe("Nueva frecuencia de pago"),
        payment_method: z.string().optional().describe("Nuevo método de pago"),
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
      description: "Obtiene las pólizas que están por vencer o renovar en los próximos días (por defecto los siguientes 30 días).",
      schema: z.object({
        days: z.number().optional().describe("Días a futuro para buscar vencimientos (default: 30)"),
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
      description: "Obtiene estadísticas clave agregadas de la cartera de pólizas del asesor (total de pólizas, primas totales por moneda, pólizas por ramo y pólizas por estatus).",
      schema: z.object({}),
    },
    async execute(_args, ctx) {
      const policies = await ctx.policyService.getByField("agent_id", ctx.agentId);
      if (!policies || policies.length === 0) {
        return { totalPolicies: 0, message: "No tienes pólizas en tu cartera." };
      }

      const statusCounts: Record<string, number> = {};
      const branchCounts: Record<string, number> = {};
      const premiumSums: Record<string, number> = {};

      for (const p of policies) {
        const statusName = p.status?.name || "Desconocido";
        statusCounts[statusName] = (statusCounts[statusName] || 0) + 1;

        const branchName = p.product?.branch?.name || "Desconocido";
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
      description: "Busca pólizas en la cartera del asesor por coincidencia de texto. Si el usuario menciona el nombre de un cliente en su petición, debes buscar primero al cliente con search_contact para obtener su contact_id y pasarlo en el parámetro contact_id de esta función, utilizando el parámetro query únicamente para filtrar por el ramo, producto o número de póliza (ej: 'auto', 'GNP').",
      schema: z.object({
        query: z.string({ required_error: "Texto de búsqueda" }).describe("Texto a buscar (ej: 'auto', 'GNP', número de póliza)"),
        contact_id: z.string().optional().describe("UUID del contacto para limitar la búsqueda (opcional)"),
      }),
    },
    async execute({ query, contact_id }, ctx) {
      const items = await ctx.policyService.searchPolicies(ctx.agentId, query as string, contact_id as string | undefined);
      return (items ?? []).map(slimPolicy);
    },
  },
];

