import { z } from "zod";

export const PolicyExtractionSchema = z.object({
  // 1. Contract Identification & Status
  policyNumber: z.string().nullable().describe("Policy number"),
  policyVersion: z.string().nullable().describe("Policy version or endorsement number, ONLY when printed as its OWN separate field in the carátula (e.g. 'Versión: 3', 'No. de Endoso: 004512'). Do NOT duplicate the (N)/(R)/(E) suffix here if it is already part of policyNumber — that suffix stays embedded in policyNumber per its own instructions. Null if there is no distinct version/endorsement field."),
  carrierName: z.string().nullable().describe("Insurance carrier name"),
  productName: z.string().nullable().describe("Product or commercial plan name"),
  branchName: z.string().nullable().describe("Insurance branch: Life, Health, Auto, Property, Annuity, Investment, etc."),
  status: z.string().nullable().describe("Current policy state: ACTIVE, CANCELLED, SUSPENDED, LAPSED"),
  movementType: z.string().nullable().describe("Document movement type: NUEVA, RENOVACION, ENDOSO, CANCELACION"),

  // 2. Policyholder / Contracting Party — used to identify or create the contact record, not stored in policies
  holderName: z.string().nullable().describe("Full name of the policyholder or contracting party"),
  holderBirthdate: z.string().nullable().describe("Policyholder date of birth (YYYY-MM-DD)"),
  holderRfc: z.string().nullable().describe("Policyholder RFC (Mexican tax ID)"),
  holderContact: z.object({
    email: z.string().nullable(),
    phone: z.string().nullable(),
    address: z.string().nullable(),
  }).nullable().describe("Policyholder contact details (email, phone, address)"),

  // 3. Dates & Coverage Period
  issueDate: z.string().nullable().describe("Policy issue date (YYYY-MM-DD) — when this document/carátula was generated. Resets on every renewal, unlike seniorityDate."),
  startDate: z.string().nullable().describe("Coverage start date (YYYY-MM-DD)"),
  endDate: z.string().nullable().describe("Coverage end date (YYYY-MM-DD)"),
  renewalDate: z.string().nullable().describe("Renewal date (YYYY-MM-DD)"),
  nextPaymentDate: z.string().nullable().describe("Next payment due date (YYYY-MM-DD)"),
  seniorityDate: z.string().nullable().describe(
    "Recognized seniority date (fecha de antigüedad reconocida / antigüedad del asegurado), YYYY-MM-DD. Common on GMM and Life policies — it is the original date the holder first gained coverage (possibly with a prior carrier that recognized seniority), used to determine waiting periods and pre-existing condition coverage. It does NOT reset on renewal, unlike issueDate, and is usually printed separately in the carátula as 'antigüedad' or 'fecha de antigüedad'. Null if not shown in the document."
  ),

  // 4. Financial / Economic Fields
  sumInsured: z.number().nullable().describe("Basic sum insured or initial investment balance"),
  premium: z.number().nullable().describe("Total premium or amount due including taxes"),
  currency: z.string().nullable().describe("Currency: MXN, USD, or UDI"),
  paymentFrequency: z.string().nullable().describe("Payment frequency: MONTHLY, QUARTERLY, SEMIANNUAL, ANNUAL, SINGLE"),
  paymentMethod: z.string().nullable().describe("Payment method: DIRECT_DEBIT, BANK_TRANSFER, CHECK, CASH, CREDIT_CARD"),

  // 5. Global Parameters (e.g. Health, Property)
  globalDeductible: z.string().nullable().describe("Global deductible applicable to the policy (amount or percentage, e.g. '10%' or '$5,000')"),
  globalCoinsurance: z.string().nullable().describe("Global coinsurance applicable to the policy (percentage, e.g. '10%'). Common on GMM policies — the share of each claim the insured pays after the deductible."),

  // 6. Additional Insured & Beneficiaries
  additionalInsured: z.array(z.object({
    fullName: z.string(),
    birthdate: z.string().nullable(),
    relationship: z.string().nullable(),
  })).default([]).describe("Additional insured or dependents covered by the policy"),

  beneficiaries: z.array(z.object({
    fullName: z.string(),
    relationship: z.string().nullable(),
    percentage: z.number().nullable(),
  })).default([]).describe("Policy beneficiaries (percentages typically sum to 100)"),

  // 7. Insured Risk Objects (Physical Assets)
  riskObjects: z.array(z.object({
    type: z.string().describe("Risk type: VEHICLE, PROPERTY, PET, DEVICE, etc."),
    identifier: z.string().nullable().describe("Primary identifier: VIN, license plate, microchip number, etc."),
    description: z.string().nullable().describe("Human-readable description: e.g. 'Suzuki Swift Sport 2021 manual gasoline', 'House in Pachuca'"),
  })).default([]).describe("Physical assets insured under the policy (excluding the policyholder). Full technical detail goes here for RAG search — this is separate from insuredItem, which is only a short display label."),
  insuredItem: z.string().nullable().describe(
    "Short human-readable label for the insured physical asset, used as a quick display name (NOT for storing full technical detail — that goes in riskObjects). Only applies to property/asset branches: Auto (e.g. 'Suzuki Swift 2021 · ABC-123'), Hogar/Daños (e.g. 'Casa Pachuca, Col. Centro'), Mascotas (e.g. 'Firulais · labrador 4 años'). Null for policies insuring a person (Vida, GMM, Accidentes Personales, Retiro, Educación)."
  ),

  // 8. Coverages or Sub-funds — goes to RAG
  coverages: z.array(z.object({
    name: z.string(),
    amount: z.number().nullable(),
    description: z.string().nullable().describe(
      "Any per-coverage detail worth keeping for search: its own deductible/coinsurance if it differs from the global one, waiting period, hospital tier or network (GMM), or guarantee/sub-fund terms (Life/investment)."
    ),
  })).default([]).describe("List of coverages, guarantees, or investment sub-funds"),

  // 9. Intermediary / Agent
  agentDetails: z.object({
    name: z.string().nullable().describe("Agent or advisor name"),
    code: z.string().nullable().describe("Agent code"),
    agency: z.string().nullable().describe("Promoter, agency, or broker name"),
  }).nullable().describe("Intermediary who commercializes the policy"),

  // 10. Notes & RAG Summary
  notes: z.string().nullable().describe("Additional notes, special clauses, or specific policy conditions"),
  summary: z.string().describe(
    "Complete prose summary of the policy in English, optimized for semantic search — this is the ONLY place some details survive, so be thorough. Include: carrier, branch, product, holder name, RFC, coverage period, seniority date if present, premium, payment frequency, risk objects with full identifiers (VIN, license plate, serial number), global deductible/coinsurance, additional insured, beneficiaries, and main coverages. " +
    "Also include, when present in the document and not already captured elsewhere: the premium breakdown (net premium, policy fee/derecho de póliza, installment surcharge, VAT/IVA), the exact amount due per payment installment (recibo) given the payment frequency, hospital tier/network or tabulador (GMM), waiting periods and pre-existing condition rules (GMM), insurance term vs. payment term and guaranteed/surrender values (Life dotal or PPR/retirement plans), the agent/promoter code, and any notable exclusions or special clauses. " +
    "Write naturally as if explaining it to someone, without JSON syntax or bullet points."
  ),
});

export type PolicyExtraction = z.infer<typeof PolicyExtractionSchema>;
