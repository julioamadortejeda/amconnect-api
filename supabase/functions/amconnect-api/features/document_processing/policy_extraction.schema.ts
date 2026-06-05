import { z } from "zod";

export const PolicyExtractionSchema = z.object({
  policyNumber: z.string().nullable().describe("Número de póliza"),
  carrierName: z.string().nullable().describe("Nombre de la aseguradora"),
  productName: z.string().nullable().describe("Nombre del producto o plan"),
  branchName: z.string().nullable().describe("Ramo: Vida, GMM, Auto, Daños, etc."),

  // Titular / contratante
  holderName: z.string().nullable().describe("Nombre completo del contratante o titular"),
  holderBirthdate: z.string().nullable().describe("Fecha de nacimiento del titular (YYYY-MM-DD)"),
  holderRfc: z.string().nullable().describe("RFC del titular"),

  // Económicos
  sumInsured: z.number().nullable().describe("Suma asegurada o cobertura total"),
  premium: z.number().nullable().describe("Prima total del período"),
  currency: z.string().nullable().describe("Moneda: MXN o USD"),
  paymentFrequency: z.string().nullable().describe("Frecuencia de pago: Mensual, Trimestral, Semestral, Anual"),
  paymentMethod: z.string().nullable().describe("Forma de pago: Domiciliación, Transferencia, etc."),

  // Vigencia
  startDate: z.string().nullable().describe("Fecha de inicio de vigencia (YYYY-MM-DD)"),
  endDate: z.string().nullable().describe("Fecha de fin de vigencia (YYYY-MM-DD)"),
  renewalDate: z.string().nullable().describe("Fecha de renovación (YYYY-MM-DD)"),
  nextPaymentDate: z.string().nullable().describe("Próxima fecha de pago (YYYY-MM-DD)"),

  // Asegurados adicionales
  additionalInsured: z.array(z.object({
    fullName: z.string(),
    birthdate: z.string().nullable(),
    relationship: z.string().nullable(),
  })).default([]).describe("Asegurados adicionales"),

  // Beneficiarios
  beneficiaries: z.array(z.object({
    fullName: z.string(),
    relationship: z.string().nullable(),
    percentage: z.number().nullable(),
  })).default([]).describe("Beneficiarios de la póliza"),

  // Coberturas principales (resumen)
  coverages: z.array(z.object({
    name: z.string(),
    amount: z.number().nullable(),
    description: z.string().nullable(),
  })).default([]).describe("Coberturas principales"),

  notes: z.string().nullable().describe("Notas adicionales relevantes de la póliza"),

  // Natural language summary for RAG embeddings
  summary: z.string().describe(
    "Complete prose summary of the policy in English. Include: carrier, branch, product, holder name, RFC, coverage period, premium, payment frequency, additional insured, beneficiaries, and all coverages with their amounts. Write naturally as if explaining it to someone, without JSON syntax or bullet points.",
  ),
});

export type PolicyExtraction = z.infer<typeof PolicyExtractionSchema>;

export const POLICY_EXTRACTION_PROMPT = `
You are an expert extractor of Mexican insurance policy data.
Analyze the attached document and extract ALL relevant information following the indicated schema.
- Dates must be in YYYY-MM-DD format.
- Amounts must be plain numbers without formatting (no commas or currency symbols).
- If a field is not present in the document, use null.
- Extract all additional insured and beneficiaries found.
- The 'coverages' field must include all main coverages with their insured amounts.
- The 'summary' field must be a natural prose paragraph in English describing the complete policy, optimized for semantic search.
`.trim();
