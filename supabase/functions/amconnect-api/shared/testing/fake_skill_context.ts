// SkillContext falso para probar skills por `executeSkill`, el mismo camino que
// usan el chat de texto y la voz.
//
// Los fakes viven al nivel de los services de módulo (contactService,
// policyService, ...): cada método guarda lo que recibió en `calls` y devuelve
// lo que la prueba puso en `data`. Si una skill llama a un método que aquí no
// existe, la prueba truena en vez de pasar en silencio.
import type { SkillContext } from "../../features/ai_chat/skills/skill.core.ts";
import type { ContactResponseDTO } from "../../modules/contact/contact.dto.ts";
import type { PolicyResponseDTO } from "../../modules/policy/policy.dto.ts";
import type { ReminderResponseDTO } from "../../modules/reminder/reminder.dto.ts";
import type { CommitmentCloseResult, CommitmentResponseDTO } from "../../features/commitments/commitment.dto.ts";
import { withRealWorkflows } from "./skill_workflows.ts";

export const SKILL_AGENT = "agent-1";
export const SKILL_SESSION = "session-1";
export const SKILL_TZ = "America/Mexico_City";

export interface Call {
  fn: string;
  args: unknown[];
}

/** Lo que devuelven los fakes. La prueba lo ajusta antes de ejecutar la skill. */
export interface FakeData {
  similarContacts: ContactResponseDTO[];
  matchingContact: { id: string; fullName: string } | null;
  createdContact: ContactResponseDTO | null;
  contactById: ContactResponseDTO | null;
  /** Por contact_id (o "*" para cualquiera). */
  policiesByContact: Record<string, PolicyResponseDTO[]>;
  agentPolicies: PolicyResponseDTO[];
  searchedPolicies: PolicyResponseDTO[];
  policyById: PolicyResponseDTO | null;
  duplicatePolicies: { id: string }[];
  createdPolicy: PolicyResponseDTO | null;
  updatedPolicy: PolicyResponseDTO | null;
  reminder: ReminderResponseDTO | null;
  upcoming: ReminderResponseDTO[];
  searchedReminders: ReminderResponseDTO[];
  countAfter: number;
  /** Respuestas en orden para las llamadas sucesivas a countPendingBefore. */
  countBefore: number[];
  reminderTypes: Record<string, unknown>[];
  reminderStatuses: Record<string, unknown>[];
  policyStatuses: Record<string, unknown>[];
  currencies: Record<string, unknown>[];
  paymentFrequencies: Record<string, unknown>[];
  paymentMethods: Record<string, unknown>[];
  /** Resultado de `search` por catálogo por agente: carrier/branch/product. */
  catalogSearch: Record<string, Record<string, unknown>[]>;
  sessionMetadata: Record<string, unknown> | null;
  generatedReminders: unknown[];
  commitments: CommitmentResponseDTO[];
  closeResult: CommitmentCloseResult;
  updatedCommitment: CommitmentResponseDTO | null;
}

export function defaultData(): FakeData {
  return {
    similarContacts: [],
    matchingContact: null,
    createdContact: null,
    contactById: null,
    policiesByContact: {},
    agentPolicies: [],
    searchedPolicies: [],
    policyById: null,
    duplicatePolicies: [],
    createdPolicy: null,
    updatedPolicy: null,
    reminder: null,
    upcoming: [],
    searchedReminders: [],
    countAfter: 0,
    countBefore: [],
    reminderTypes: [],
    reminderStatuses: [],
    policyStatuses: [],
    currencies: [],
    paymentFrequencies: [],
    paymentMethods: [],
    catalogSearch: {},
    sessionMetadata: null,
    generatedReminders: [],
    commitments: [],
    closeResult: { outcome: "not_found" },
    updatedCommitment: null,
  };
}

export interface FakeSkillContext {
  ctx: SkillContext;
  calls: Call[];
  data: FakeData;
  /** Llamadas a un método, p. ej. `called("policyService.searchPolicies")`. */
  called(fn: string): unknown[][];
}

export function fakeSkillContext(overrides: Partial<FakeData> = {}): FakeSkillContext {
  const data: FakeData = { ...defaultData(), ...overrides };
  const calls: Call[] = [];

  // deno-lint-ignore no-explicit-any
  const rec = <T>(fn: string, result: (...args: any[]) => T) =>
    // deno-lint-ignore no-explicit-any
    (...args: any[]): Promise<T> => {
      calls.push({ fn, args });
      return Promise.resolve(result(...args));
    };

  const agentCatalog = (name: string) => ({
    search: rec(`catalog.${name}.search`, () => data.catalogSearch[name] ?? []),
    create: rec(`catalog.${name}.create`, (payload: Record<string, unknown>) => ({ id: `${name}-new`, ...payload })),
  });

  const globalCatalog = (name: string, rows: () => Record<string, unknown>[]) => ({
    getAll: rec(`catalog.${name}.getAll`, () => rows()),
    getByCode: rec(`catalog.${name}.getByCode`, (code: string) => rows().find((r) => r.code === code) ?? null),
  });

  const base = {
    agentId: SKILL_AGENT,
    sessionId: SKILL_SESSION,
    timezone: SKILL_TZ,
    timezoneOffset: "-06:00",
    advisorWords: "lo que escribió el asesor",
    contactService: {
      findSimilarContact: rec("contactService.findSimilarContact", () => data.similarContacts),
      findMatchingContact: rec("contactService.findMatchingContact", () => data.matchingContact),
      create: rec("contactService.create", () => data.createdContact),
      getById: rec("contactService.getById", () => data.contactById),
      getByField: rec("contactService.getByField", () => data.similarContacts),
      count: rec("contactService.count", () => data.similarContacts.length),
      update: rec("contactService.update", () => data.contactById),
      delete: rec("contactService.delete", () => data.contactById),
    },
    policyService: {
      getByField: rec("policyService.getByField", (field: string, value: string) =>
        field === "agent_id" ? data.agentPolicies : data.policiesByContact[value] ?? data.policiesByContact["*"] ?? []),
      searchPolicies: rec("policyService.searchPolicies", (_a: string, _q: string, contactId?: string) =>
        contactId && data.policiesByContact[contactId] ? data.policiesByContact[contactId] : data.searchedPolicies),
      findByFilters: rec("policyService.findByFilters", () => data.duplicatePolicies),
      create: rec("policyService.create", () => data.createdPolicy),
      update: rec("policyService.update", () => data.updatedPolicy),
      getById: rec("policyService.getById", () => data.policyById),
      addBeneficiary: rec("policyService.addBeneficiary", () => null),
      getParticipants: rec("policyService.getParticipants", () => []),
      getBeneficiaries: rec("policyService.getBeneficiaries", () => []),
      count: rec("policyService.count", () => data.agentPolicies.length),
      getUpcomingExpirations: rec("policyService.getUpcomingExpirations", () => data.agentPolicies),
    },
    reminderService: {
      create: rec("reminderService.create", () => data.reminder),
      update: rec("reminderService.update", () => data.reminder),
      delete: rec("reminderService.delete", () => data.reminder),
      getUpcoming: rec("reminderService.getUpcoming", () => data.upcoming),
      countPendingAfter: rec("reminderService.countPendingAfter", () => data.countAfter),
      countPendingBefore: rec("reminderService.countPendingBefore", () => data.countBefore.shift() ?? 0),
      searchReminders: rec("reminderService.searchReminders", () => data.searchedReminders),
    },
    catalogServices: {
      reminderTypeService: globalCatalog("reminderType", () => data.reminderTypes),
      reminderStatusService: globalCatalog("reminderStatus", () => data.reminderStatuses),
      policyStatusService: globalCatalog("policyStatus", () => data.policyStatuses),
      currencyService: globalCatalog("currency", () => data.currencies),
      paymentFrequencyService: globalCatalog("paymentFrequency", () => data.paymentFrequencies),
      paymentMethodService: globalCatalog("paymentMethod", () => data.paymentMethods),
      carrierService: agentCatalog("carrier"),
      branchService: agentCatalog("branch"),
      productService: {
        ...agentCatalog("product"),
        findByNameInCarrier: rec(
          "catalog.product.findByNameInCarrier",
          () => data.catalogSearch["product"] ?? [],
        ),
      },
    },
    commitmentService: {
      list: rec("commitmentService.list", () => data.commitments),
      create: rec("commitmentService.create", () => data.commitments[0]),
      update: rec("commitmentService.update", () => data.updatedCommitment),
      reopen: rec("commitmentService.reopen", () => data.updatedCommitment),
      close: rec("commitmentService.close", () => data.closeResult),
    },
    aiSessionService: {
      getSessionMetadata: rec("aiSessionService.getSessionMetadata", () => data.sessionMetadata),
      updateMetadata: rec("aiSessionService.updateMetadata", () => undefined),
      trackEmbeddingUsageOnly: rec("aiSessionService.trackEmbeddingUsageOnly", () => undefined),
    },
    embeddingsService: {
      embeddingModelName: "test-embedding",
      saveDocument: rec("embeddingsService.saveDocument", () => ({ noteId: "note-new", embeddingTotalTokens: 7, embeddingCount: 1 })),
      updateNoteLinks: rec("embeddingsService.updateNoteLinks", () => undefined),
      softDeleteNoteById: rec("embeddingsService.softDeleteNoteById", () => undefined),
      softDeleteNotesByPolicy: rec("embeddingsService.softDeleteNotesByPolicy", () => undefined),
    },
    reminderGenerationService: {
      generateForPolicy: rec("reminderGenerationService.generateForPolicy", () => data.generatedReminders),
    },
    usageService: {
      checkAndIncrementIngestion: rec("usageService.checkAndIncrementIngestion", () => "charge-1"),
      refundCharge: rec("usageService.refundCharge", () => undefined),
    },
    knowledgeIngestionService: {
      ingestText: rec("knowledgeIngestionService.ingestText", () => ({ noteId: "note-1" })),
    },
    ragService: {
      searchNotes: rec("ragService.searchNotes", () => []),
    },
  };

  // Los workflow services son los REALES, montados sobre los fakes: la prueba
  // ejercita las reglas de negocio, no un doble de ellas.
  const ctx = withRealWorkflows(base as unknown as SkillContext);

  return {
    ctx,
    calls,
    data,
    called: (fn: string) => calls.filter((c) => c.fn === fn).map((c) => c.args),
  };
}

/** Silencia los console.warn/error del executor mientras corre `fn`. */
export function quiet<T>(fn: () => Promise<T>): Promise<T> {
  const { warn, error } = console;
  console.warn = () => {};
  console.error = () => {};
  return fn().finally(() => {
    console.warn = warn;
    console.error = error;
  });
}

// ─── Constructores de datos ─────────────────────────────────────────────────

export function buildContact(overrides: Partial<ContactResponseDTO> = {}): ContactResponseDTO {
  return {
    id: "c-1",
    agentId: SKILL_AGENT,
    fullName: "Julio Pérez",
    email: "julio@example.com",
    phone: "5550000000",
    birthdate: null,
    rfc: null,
    curp: null,
    address: null,
    occupation: null,
    referredById: null,
    externalReferrerSource: null,
    isProspect: false,
    isActive: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    ...overrides,
  };
}

export function buildPolicy(overrides: Partial<PolicyResponseDTO> = {}): PolicyResponseDTO {
  return {
    id: "p-1",
    agentId: SKILL_AGENT,
    contactId: "c-1",
    productId: "prod-1",
    statusId: "st-1",
    currencyId: "cur-1",
    paymentFrequencyId: null,
    paymentMethodId: null,
    policyNumber: "GM-001",
    sumInsured: 1000000,
    premium: 25000,
    startDate: "2026-01-01",
    endDate: "2027-01-01",
    renewalDate: "2027-01-01",
    nextPaymentDate: "2026-12-01",
    notes: null,
    deductible: "10%",
    coinsurance: "10%",
    seniorityDate: null,
    insuredItem: null,
    policyVersion: null,
    isActive: true,
    createdAt: "2026-01-01T00:00:00Z",
    updatedAt: "2026-01-01T00:00:00Z",
    contact: { id: "c-1", fullName: "Julio Pérez" },
    product: {
      id: "prod-1",
      name: "Alfa Medical",
      carrier: { id: "car-1", name: "GNP" },
      branch: { id: "br-1", name: "GMM" },
    },
    status: { id: "st-1", code: "ACTIVE", name: "Active" },
    currency: { id: "cur-1", code: "MXN", name: "Peso" },
    ...overrides,
  };
}

export function buildReminder(overrides: Partial<ReminderResponseDTO> = {}): ReminderResponseDTO {
  return {
    id: "r-1",
    agentId: SKILL_AGENT,
    contactId: "c-1",
    policyId: null,
    typeId: "type-call",
    title: "Llamar a Julio",
    description: "Dar seguimiento a la cotización",
    // 18:00 UTC = 12:00 en Ciudad de México (UTC-6, sin horario de verano).
    dueDate: "2026-12-03T18:00:00.000Z",
    statusId: "status-created",
    comments: [{ id: "cm-1", reminderId: "r-1", agentId: SKILL_AGENT, content: "Le urge", createdAt: "2026-12-01T18:00:00.000Z" }],
    notes: [],
    notifiedAt: null,
    createdAt: "2026-12-01T00:00:00Z",
    updatedAt: "2026-12-01T00:00:00Z",
    type: { id: "type-call", name: "Call", code: "CALL" },
    status: { id: "status-created", name: "Created", code: "CREATED" },
    contact: { id: "c-1", fullName: "Julio Pérez" },
    policy: undefined,
    ...overrides,
  };
}

export function buildCommitment(overrides: Partial<CommitmentResponseDTO> = {}): CommitmentResponseDTO {
  return {
    id: "cm-1",
    agentId: SKILL_AGENT,
    contactId: "c-1",
    label: "esperando INE de Julio",
    quote: "Julio me va a mandar su INE",
    dueFrom: null,
    dueTo: null,
    status: "OPEN",
    resolutionNote: null,
    resolvedAt: null,
    resolvedBySessionId: null,
    createdAt: "2026-11-01T00:00:00Z",
    contact: { id: "c-1", fullName: "Julio Pérez" },
    ...overrides,
  };
}
