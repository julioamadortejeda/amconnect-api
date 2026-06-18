import { z } from "zod";

export const PolicyExtractionSchema = z.object({
  // 1. Contract Identification & Status
  policyNumber: z.string().nullable().describe("Policy number"),
  policyVersion: z.string().nullable().describe("Policy version or endorsement number"),
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
  issueDate: z.string().nullable().describe("Policy issue date (YYYY-MM-DD)"),
  startDate: z.string().nullable().describe("Coverage start date (YYYY-MM-DD)"),
  endDate: z.string().nullable().describe("Coverage end date (YYYY-MM-DD)"),
  renewalDate: z.string().nullable().describe("Renewal date (YYYY-MM-DD)"),
  nextPaymentDate: z.string().nullable().describe("Next payment due date (YYYY-MM-DD)"),

  // 4. Financial / Economic Fields
  sumInsured: z.number().nullable().describe("Basic sum insured or initial investment balance"),
  premium: z.number().nullable().describe("Total premium or amount due including taxes"),
  currency: z.string().nullable().describe("Currency: MXN, USD, or UDI"),
  paymentFrequency: z.string().nullable().describe("Payment frequency: MONTHLY, QUARTERLY, SEMIANNUAL, ANNUAL, SINGLE"),
  paymentMethod: z.string().nullable().describe("Payment method: DIRECT_DEBIT, BANK_TRANSFER, CHECK, CASH, CREDIT_CARD"),

  // 5. Global Parameters (e.g. Health, Property)
  globalDeductible: z.string().nullable().describe("Global deductible applicable to the policy (amount or percentage, e.g. '10%' or '$5,000')"),
  globalCoinsurance: z.string().nullable().describe("Global coinsurance applicable to the policy (percentage, e.g. '10%')"),

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
  })).default([]).describe("Physical assets insured under the policy (excluding the policyholder)"),

  // 8. Coverages or Sub-funds — goes to RAG
  coverages: z.array(z.object({
    name: z.string(),
    amount: z.number().nullable(),
    description: z.string().nullable(),
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
    "Complete prose summary of the policy in English. Include: carrier, branch, product, holder name, RFC, coverage period, premium, payment frequency, risk objects, global deductible/coinsurance, additional insured, beneficiaries, and main coverages. Write naturally as if explaining it to someone, without JSON syntax or bullet points."
  ),
});

export type PolicyExtraction = z.infer<typeof PolicyExtractionSchema>;
