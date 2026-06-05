import { z } from "zod";
import { SkillDefinition } from "./skill.core.ts";

const slimPolicy = (p: Record<string, unknown>) => ({
  id: p.id,
  policyNumber: p.policyNumber,
  contactId: p.contactId,
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
      return policies.map(slimPolicy);
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
      return policies.map(slimPolicy);
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
];
