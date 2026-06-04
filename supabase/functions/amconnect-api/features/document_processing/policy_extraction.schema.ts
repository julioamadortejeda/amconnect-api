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
});

export type PolicyExtraction = z.infer<typeof PolicyExtractionSchema>;

export const POLICY_EXTRACTION_PROMPT = `
Eres un extractor experto de datos de pólizas de seguros mexicanas.
Analiza el documento adjunto y extrae TODA la información relevante siguiendo el esquema indicado.
- Las fechas deben estar en formato YYYY-MM-DD.
- Los montos deben ser números sin formato (sin comas ni símbolo de moneda).
- Si un campo no está presente en el documento, usa null.
- Para beneficiarios y asegurados adicionales, extrae todos los que encuentres.
- El campo 'coverages' debe incluir las coberturas principales con sus sumas aseguradas.
`.trim();
