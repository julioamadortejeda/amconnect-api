// Pruebas de caracterización: fijan lo que el MODELO recibe de cada skill
// (respuesta + __skillMetadata) y qué services se llaman, para poder mover la
// lógica de negocio a services sin cambiar ni un byte de lo que ve el modelo.
//
// Se escribieron ANTES del refactor skills → services, contra el código de
// entonces; deben seguir verdes después.
//
// test_env va primero: el registro de skills importa módulos que leen config.
import "../../../shared/testing/test_env.ts";
import assert from "node:assert/strict";
import { executeSkill } from "./skill_executor.ts";
import {
  buildCommitment,
  buildContact,
  buildPolicy,
  buildReminder,
  fakeSkillContext,
  quiet,
  SKILL_AGENT,
  SKILL_SESSION,
} from "../../../shared/testing/fake_skill_context.ts";

const UUID = "3f1c2a8e-5b7d-4e19-9a0c-2d6f8b1e4c37";

const run = (name: string, args: unknown, ctx: Parameters<typeof executeSkill>[2]) =>
  quiet(() => executeSkill(name, args, ctx));

const slimPolicyOf = (p: ReturnType<typeof buildPolicy>) => ({
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
  deductible: p.deductible,
  coinsurance: p.coinsurance,
  seniorityDate: p.seniorityDate,
  insuredItem: p.insuredItem,
  policyVersion: p.policyVersion,
  product: p.product,
  status: p.status,
});

// Recordatorio de buildReminder() tal como lo ve el modelo (hora de CDMX).
const SLIM_REMINDER = {
  id: "r-1",
  title: "Llamar a Julio",
  description: "Dar seguimiento a la cotización",
  dueDate: "2026-12-03T12:00:00-06:00",
  dueWeekday: "Thursday",
  statusId: "status-created",
  status: { id: "status-created", name: "Created", code: "CREATED" },
  comments: [{ id: "cm-1", reminderId: "r-1", agentId: SKILL_AGENT, content: "Le urge", createdAt: "2026-12-01T12:00:00-06:00" }],
  notes: [],
  contactId: "c-1",
  policyId: null,
  type: { id: "type-call", name: "Call", code: "CALL" },
  contact: { id: "c-1", fullName: "Julio Pérez" },
  policy: undefined,
};

const REMINDER_TYPES = [
  { id: "type-other", code: "OTHER", name: "Other" },
  { id: "type-call", code: "CALL", name: "Phone call" },
  { id: "type-follow", code: "FOLLOW_UP", name: "Follow up" },
];

// ─── Contactos: búsqueda y desambiguación ───────────────────────────────────

Deno.test("search_contact: devuelve los contactos recortados y la tarjeta", async () => {
  const julio = buildContact({ occupation: "Ingeniero" });
  const { ctx, called } = fakeSkillContext({ similarContacts: [julio] });
  const { response, metadata } = await run("search_contact", { query: "julio" }, ctx);
  const slim = {
    id: "c-1",
    fullName: "Julio Pérez",
    phone: "5550000000",
    email: "julio@example.com",
    birthdate: null,
    occupation: "Ingeniero",
    address: null,
    rfc: null,
    curp: null,
  };
  // El modelo lee el teléfono formateado; la tarjeta conserva el crudo (la app lo formatea).
  assert.deepEqual(response, { contacts: [{ ...slim, phone: "55 5000 0000" }] });
  assert.deepEqual(metadata, { type: "contact_list", contacts: [slim] });
  assert.deepEqual(called("contactService.findSimilarContact"), [[SKILL_AGENT, "julio"]]);
});

Deno.test("search_contact: sin resultados no hay tarjeta", async () => {
  const { ctx } = fakeSkillContext();
  const { response, metadata } = await run("search_contact", { query: "nadie" }, ctx);
  assert.deepEqual(response, { contacts: [] });
  assert.equal(metadata, undefined);
});

Deno.test("add_note_to_client: sin coincidencias → error con el nombre", async () => {
  const { ctx, called } = fakeSkillContext();
  const { response } = await run("add_note_to_client", { client_name: "Zoila", note_content: "hola" }, ctx);
  assert.deepEqual(response, { error: "No client found matching 'Zoila'." });
  assert.equal(called("knowledgeIngestionService.ingestText").length, 0);
});

Deno.test("add_note_to_client: dos coincidencias → pide ser más específico con las opciones", async () => {
  const { ctx, called } = fakeSkillContext({
    similarContacts: [buildContact(), buildContact({ id: "c-2", fullName: "Julio César" })],
  });
  const { response } = await run("add_note_to_client", { client_name: "Julio", note_content: "hola" }, ctx);
  assert.deepEqual(response, {
    error: "Multiple clients found matching 'Julio'. Please be more specific.",
    matches: [{ id: "c-1", fullName: "Julio Pérez" }, { id: "c-2", fullName: "Julio César" }],
  });
  assert.equal(called("knowledgeIngestionService.ingestText").length, 0);
});

Deno.test("add_note_to_client: uno solo, nota corta → ingesta sin cobrar cuota", async () => {
  const { ctx, called } = fakeSkillContext({ similarContacts: [buildContact()] });
  const { response } = await run("add_note_to_client", { client_name: "Julio", note_content: "le gusta el golf" }, ctx);
  assert.deepEqual(response, { success: true, message: "Note added successfully to Julio Pérez." });
  assert.equal(called("usageService.checkAndIncrementIngestion").length, 0);
  assert.deepEqual(called("knowledgeIngestionService.ingestText"), [[
    SKILL_AGENT,
    SKILL_SESSION,
    { content: "le gusta el golf", sourceType: "text", contactId: "c-1" },
  ]]);
});

Deno.test("add_note_to_client: nota larga → cobra una ingesta antes de guardar", async () => {
  const { ctx, calls } = fakeSkillContext({ similarContacts: [buildContact()] });
  await run("add_note_to_client", { client_name: "Julio", note_content: "x".repeat(301) }, ctx);
  const order = calls.map((c) => c.fn).filter((f) => f.startsWith("usage") || f.startsWith("knowledge"));
  assert.deepEqual(order, ["usageService.checkAndIncrementIngestion", "knowledgeIngestionService.ingestText"]);
});

Deno.test("create_contact: con notas largas cobra y manda a ingesta; devuelve el contacto y la tarjeta", async () => {
  const created = buildContact({ id: "c-9", fullName: "Rosa Díaz", isProspect: true });
  const { ctx, called } = fakeSkillContext({ createdContact: created });
  const { response, metadata } = await run("create_contact", {
    full_name: "rosa díaz",
    is_prospect: true,
    notes: "y".repeat(400),
  }, ctx);
  assert.deepEqual(response, { ...created, phone: "55 5000 0000" }); // el modelo lee el formateado
  assert.deepEqual(metadata, {
    type: "contact_created",
    contactId: "c-9",
    fullName: "Rosa Díaz",
    email: "julio@example.com",
    phone: "5550000000",
    isProspect: true,
  });
  assert.deepEqual(called("contactService.create")[0][0], {
    agentId: SKILL_AGENT,
    fullName: "rosa díaz",
    email: null,
    phone: null,
    birthdate: null,
    rfc: null,
    curp: null,
    address: null,
    occupation: null,
    isProspect: true,
  });
  assert.equal(called("usageService.checkAndIncrementIngestion").length, 1);
  assert.equal(called("knowledgeIngestionService.ingestText").length, 1);
});

Deno.test("delete_contact: mensaje con el nombre, o error si no existe", async () => {
  const ok = fakeSkillContext({ contactById: buildContact() });
  assert.deepEqual((await run("delete_contact", { contact_id: "c-1" }, ok.ctx)).response, {
    success: true,
    message: "Contact 'Julio Pérez' deleted successfully.",
  });
  const missing = fakeSkillContext();
  assert.deepEqual((await run("delete_contact", { contact_id: "c-1" }, missing.ctx)).response, {
    success: false,
    error: "Could not find contact to delete.",
  });
});

// ─── Pólizas ────────────────────────────────────────────────────────────────

Deno.test("search_policies: pasa las palabras tal cual y el contact_id; devuelve pólizas recortadas", async () => {
  const p = buildPolicy();
  const { ctx, called } = fakeSkillContext({ searchedPolicies: [p] });
  const { response, metadata } = await run("search_policies", { query: "GMM de GNP", contact_id: "c-7" }, ctx);
  assert.deepEqual(response, [slimPolicyOf(p)]);
  assert.equal(metadata, undefined);
  assert.deepEqual(called("policyService.searchPolicies"), [[SKILL_AGENT, "GMM de GNP", "c-7"]]);
});

Deno.test("find_policy_by_client: sin cliente → error", async () => {
  const { ctx } = fakeSkillContext();
  const { response } = await run("find_policy_by_client", { client_name: "Zoila" }, ctx);
  assert.deepEqual(response, { error: "No client found matching 'Zoila'." });
});

Deno.test("find_policy_by_client: con policy_query busca por palabras en CADA contacto parecido", async () => {
  const p1 = buildPolicy({ id: "p-1" });
  const p2 = buildPolicy({ id: "p-2", contactId: "c-2" });
  const { ctx, called } = fakeSkillContext({
    similarContacts: [buildContact(), buildContact({ id: "c-2", fullName: "Julio César" })],
    policiesByContact: { "c-1": [p1], "c-2": [p2] },
  });
  const { response } = await run("find_policy_by_client", { client_name: "Julio", policy_query: "auto" }, ctx);
  assert.deepEqual(response, [slimPolicyOf(p1), slimPolicyOf(p2)]);
  assert.deepEqual(called("policyService.searchPolicies"), [
    [SKILL_AGENT, "auto", "c-1"],
    [SKILL_AGENT, "auto", "c-2"],
  ]);
});

Deno.test("find_policy_by_client: sin policy_query trae todas las del contacto", async () => {
  const p1 = buildPolicy();
  const { ctx, called } = fakeSkillContext({ similarContacts: [buildContact()], policiesByContact: { "c-1": [p1] } });
  const { response } = await run("find_policy_by_client", { client_name: "Julio" }, ctx);
  assert.deepEqual(response, [slimPolicyOf(p1)]);
  assert.deepEqual(called("policyService.getByField"), [["contact_id", "c-1"]]);
  assert.equal(called("policyService.searchPolicies").length, 0);
});

Deno.test("get_contact_policies: pólizas recortadas + tarjeta policy_list", async () => {
  const p = buildPolicy();
  const { ctx } = fakeSkillContext({ policiesByContact: { "c-1": [p] } });
  const { response, metadata } = await run("get_contact_policies", { contact_id: "c-1" }, ctx);
  assert.deepEqual(response, { policies: [slimPolicyOf(p)] });
  assert.deepEqual(metadata, {
    type: "policy_list",
    policies: [{
      id: "p-1",
      policyNumber: "GM-001",
      holderName: "Julio Pérez",
      carrierName: "GNP",
      branchName: "GMM",
      productName: "Alfa Medical",
      statusName: "Active",
      premium: 25000,
      sumInsured: 1000000,
      renewalDate: "2027-01-01",
      nextPaymentDate: "2026-12-01",
    }],
  });
});

Deno.test("get_portfolio_stats: sin pólizas → total 0 y el mensaje", async () => {
  const { ctx } = fakeSkillContext();
  const { response } = await run("get_portfolio_stats", {}, ctx);
  assert.deepEqual(response, { totalPolicies: 0, message: "You have no policies in your portfolio." });
});

Deno.test("get_portfolio_stats: agrupa por estado, ramo y suma primas por moneda", async () => {
  const { ctx } = fakeSkillContext({
    agentPolicies: [
      buildPolicy(),
      buildPolicy({ id: "p-2", premium: 1000, currency: { id: "c", code: "USD", name: "Dollar" } }),
      buildPolicy({ id: "p-3", premium: null, status: undefined, product: undefined }),
    ],
  });
  const { response } = await run("get_portfolio_stats", {}, ctx);
  assert.deepEqual(response, {
    totalPolicies: 3,
    statusBreakdown: { Active: 2, Unknown: 1 },
    branchBreakdown: { GMM: 2, Unknown: 1 },
    premiumSummaries: { MXN: 25000, USD: 1000 },
  });
});

Deno.test("create_policy: revisa duplicado, resuelve catálogos por nombre y default ACTIVE/MXN", async () => {
  const created = buildPolicy({ id: "p-new" });
  const { ctx, called } = fakeSkillContext({
    createdPolicy: created,
    policyStatuses: [{ id: "st-cancel", code: "CANCELLED", name: "Cancelled" }, { id: "st-1", code: "ACTIVE", name: "Active" }],
    currencies: [{ id: "cur-usd", code: "USD", name: "Dollar" }, { id: "cur-1", code: "MXN", name: "Peso" }],
    paymentFrequencies: [{ id: "pf-m", code: "MONTHLY", name: "Monthly" }],
  });
  const { response } = await run("create_policy", {
    contact_id: UUID,
    product_id: UUID,
    policy_number: "GM-9",
    payment_frequency: "monthly",
    premium: 100,
  }, ctx);
  assert.deepEqual(response, slimPolicyOf(created));
  assert.deepEqual(called("policyService.findByFilters"), [[{ agent_id: SKILL_AGENT, policy_number: "GM-9" }, 1]]);
  const input = called("policyService.create")[0][0] as Record<string, unknown>;
  assert.equal(input.statusId, "st-1");
  assert.equal(input.currencyId, "cur-1");
  assert.equal(input.paymentFrequencyId, "pf-m");
  assert.equal(input.paymentMethodId, null);
  assert.equal(input.premium, 100);
  assert.equal(input.contactId, UUID);
});

Deno.test("create_policy: número duplicado → ok:false con el mensaje de conflicto, sin crear", async () => {
  const { ctx, called } = fakeSkillContext({ duplicatePolicies: [{ id: "p-old" }] });
  const { response } = await run("create_policy", { contact_id: UUID, product_id: UUID, policy_number: "GM-1" }, ctx);
  assert.equal((response as { ok: boolean }).ok, false);
  assert.match(String((response as { error: string }).error), /Ya existe una póliza activa con el número 'GM-1'/);
  assert.equal(called("policyService.create").length, 0);
});

Deno.test("update_policy: notas se anexan con fecha y el estado se resuelve por code", async () => {
  const updated = buildPolicy({ notes: "x" });
  const { ctx, called } = fakeSkillContext({
    updatedPolicy: updated,
    policyById: buildPolicy({ notes: "nota vieja" }),
    policyStatuses: [{ id: "st-cancel", code: "CANCELLED", name: "Cancelled" }],
  });
  const { response } = await run("update_policy", { policy_id: UUID, status: "CANCELLED", notes: "canceló por precio" }, ctx);
  assert.deepEqual(response, slimPolicyOf(updated));
  const [id, changes] = called("policyService.update")[0] as [string, Record<string, unknown>];
  assert.equal(id, UUID);
  assert.equal(changes.statusId, "st-cancel");
  assert.match(String(changes.notes), /^nota vieja\n\[\d{2}\/\d{2}\/\d{4}\]: canceló por precio$/);
  assert.equal("status" in changes, false);
});

// ─── Recordatorios ──────────────────────────────────────────────────────────

Deno.test("create_reminder: tipo por code, respuesta en hora local y tarjeta reminder_created", async () => {
  const { ctx, called } = fakeSkillContext({ reminder: buildReminder(), reminderTypes: REMINDER_TYPES });
  const { response, metadata } = await run("create_reminder", {
    title: "Llamar a Julio",
    due_date: "2026-12-03T12:00:00-06:00",
    reminder_type_name_or_code: "call",
  }, ctx);
  assert.deepEqual(response, SLIM_REMINDER);
  assert.deepEqual(metadata, {
    type: "reminder_created",
    reminderId: "r-1",
    title: "Llamar a Julio",
    description: "Dar seguimiento a la cotización",
    dueDate: "2026-12-03T12:00:00-06:00",
    clientName: "Julio Pérez",
  });
  assert.deepEqual(called("reminderService.create")[0][0], {
    agentId: SKILL_AGENT,
    typeId: "type-call",
    title: "Llamar a Julio",
    description: null,
    dueDate: "2026-12-03T12:00:00-06:00",
    contactId: null,
    policyId: null,
    comment: null,
  });
});

Deno.test("create_reminder: tipo por nombre parcial, y si nada coincide cae a OTHER", async () => {
  const byName = fakeSkillContext({ reminder: buildReminder(), reminderTypes: REMINDER_TYPES });
  await run("create_reminder", { title: "t", due_date: "2026-12-03", reminder_type_name_or_code: "follow" }, byName.ctx);
  assert.equal((byName.called("reminderService.create")[0][0] as { typeId: string }).typeId, "type-follow");

  const fallback = fakeSkillContext({ reminder: buildReminder(), reminderTypes: REMINDER_TYPES });
  await run("create_reminder", { title: "t", due_date: "2026-12-03", reminder_type_name_or_code: "junta" }, fallback.ctx);
  assert.equal((fallback.called("reminderService.create")[0][0] as { typeId: string }).typeId, "type-other");
});

Deno.test("create_reminder: con type_id no consulta el catálogo", async () => {
  const { ctx, called } = fakeSkillContext({ reminder: buildReminder(), reminderTypes: REMINDER_TYPES });
  await run("create_reminder", { title: "t", due_date: "2026-12-03", type_id: "type-x", contact_id: "c-1" }, ctx);
  assert.equal(called("catalog.reminderType.getAll").length, 0);
  const input = called("reminderService.create")[0][0] as Record<string, unknown>;
  assert.equal(input.typeId, "type-x");
  assert.equal(input.contactId, "c-1");
});

Deno.test("create_reminder_for_client: varios clientes → error con opciones y no crea", async () => {
  const { ctx, called } = fakeSkillContext({
    similarContacts: [buildContact(), buildContact({ id: "c-2", fullName: "Julio César" })],
  });
  const { response } = await run("create_reminder_for_client", { client_name: "Julio", due_date: "2026-12-03" }, ctx);
  assert.deepEqual(response, {
    error: "Multiple clients found matching 'Julio'. Please be more specific.",
    matches: [{ id: "c-1", fullName: "Julio Pérez" }, { id: "c-2", fullName: "Julio César" }],
  });
  assert.equal(called("reminderService.create").length, 0);
});

Deno.test("create_reminder_for_client: sin cliente → error", async () => {
  const { ctx } = fakeSkillContext();
  const { response } = await run("create_reminder_for_client", { client_name: "Zoila", due_date: "2026-12-03" }, ctx);
  assert.deepEqual(response, { error: "No client found matching 'Zoila'." });
});

Deno.test("create_reminder_for_client: un cliente → crea ligado a él; tarjeta con su nombre", async () => {
  const { ctx, called } = fakeSkillContext({
    similarContacts: [buildContact({ fullName: "Julio Pérez Soto" })],
    reminder: buildReminder(),
    reminderTypes: REMINDER_TYPES,
  });
  const { response, metadata } = await run("create_reminder_for_client", {
    client_name: "Julio",
    title: "Llamar a Julio",
    due_date: "2026-12-03T12:00:00-06:00",
    reminder_type_name_or_code: "FOLLOW_UP",
    comment: "urgente",
  }, ctx);
  assert.deepEqual(response, SLIM_REMINDER);
  assert.deepEqual(metadata, {
    type: "reminder_created",
    reminderId: "r-1",
    title: "Llamar a Julio",
    description: "Dar seguimiento a la cotización",
    dueDate: "2026-12-03T12:00:00-06:00",
    clientName: "Julio Pérez Soto",
  });
  assert.deepEqual(called("reminderService.create")[0][0], {
    agentId: SKILL_AGENT,
    typeId: "type-follow",
    title: "Llamar a Julio",
    description: null,
    dueDate: "2026-12-03T12:00:00-06:00",
    contactId: "c-1",
    comment: "urgente",
  });
});

Deno.test("update_reminder: devuelve el recordatorio recortado en hora local", async () => {
  const { ctx, called } = fakeSkillContext({ reminder: buildReminder() });
  const { response } = await run("update_reminder", { reminder_id: UUID, status: "CANCELLED", comment: "ya no aplica" }, ctx);
  assert.deepEqual(response, SLIM_REMINDER);
  assert.deepEqual(called("reminderService.update"), [[UUID, {
    title: undefined,
    description: undefined,
    dueDate: undefined,
    typeId: undefined,
    status: "CANCELLED",
    statusId: undefined,
    comment: "ya no aplica",
  }]]);
});

Deno.test("update_reminder: cancelar sin comentario → el error exacto, sin ok:false", async () => {
  const { ctx } = fakeSkillContext();
  const { response } = await run("update_reminder", { reminder_id: UUID, status: "CANCELLED", comment: "  " }, ctx);
  assert.deepEqual(response, { error: "A comment is mandatory to cancel a reminder." });
});

Deno.test("create_reminder_for_client: catálogo de tipos ilegible → mismo error que create_reminder, no crea", async () => {
  const { ctx, called } = fakeSkillContext({
    similarContacts: [buildContact({ fullName: "Julio Pérez Soto" })],
    reminder: buildReminder(),
    // deno-lint-ignore no-explicit-any
    reminderTypes: null as any,
  });
  const { response } = await run("create_reminder_for_client", { client_name: "Julio", title: "t", due_date: "2026-12-03" }, ctx);
  assert.deepEqual(response, {
    error: "Could not resolve reminder type. Make sure to pass 'type_id' or 'reminder_type_name_or_code'.",
  });
  assert.equal(called("reminderService.create").length, 0);
});

Deno.test("update_reminder: cancelar sin comentario se detecta en minúsculas y por UUID del estado", async () => {
  const lower = fakeSkillContext();
  assert.deepEqual(
    (await run("update_reminder", { reminder_id: UUID, status: "cancelled" }, lower.ctx)).response,
    { error: "A comment is mandatory to cancel a reminder." },
  );
  assert.equal(lower.called("reminderService.update").length, 0);

  const cancelledId = "9d3c8f2a-1b4e-4c5d-8e6f-7a8b9c0d1e2f";
  const byId = fakeSkillContext({ reminderStatuses: [{ id: cancelledId, code: "CANCELLED", name: "Cancelled" }] });
  assert.deepEqual(
    (await run("update_reminder", { reminder_id: UUID, status: cancelledId }, byId.ctx)).response,
    { error: "A comment is mandatory to cancel a reminder." },
  );
  assert.equal(byId.called("reminderService.update").length, 0);
});

Deno.test("mark_reminder_done: status DONE + comentario", async () => {
  const { ctx, called } = fakeSkillContext({ reminder: buildReminder() });
  const { response } = await run("mark_reminder_done", { reminder_id: UUID, comment: "listo" }, ctx);
  assert.deepEqual(response, SLIM_REMINDER);
  assert.deepEqual(called("reminderService.update"), [[UUID, { status: "DONE", comment: "listo" }]]);
});

Deno.test("delete_reminder: mensaje con el título, o error", async () => {
  const ok = fakeSkillContext({ reminder: buildReminder() });
  assert.deepEqual((await run("delete_reminder", { reminder_id: UUID }, ok.ctx)).response, {
    success: true,
    message: "Reminder 'Llamar a Julio' deleted successfully.",
  });
  const missing = fakeSkillContext();
  assert.deepEqual((await run("delete_reminder", { reminder_id: UUID }, missing.ctx)).response, {
    success: false,
    error: "Could not find the reminder to delete.",
  });
});

Deno.test("search_reminders: status como UUID se traduce a su code", async () => {
  const { ctx, called } = fakeSkillContext({
    searchedReminders: [buildReminder()],
    reminderStatuses: [{ id: UUID, code: "IN_PROGRESS", name: "In progress" }],
  });
  const { response } = await run("search_reminders", { query: "cotización", status: UUID, contact_id: "c-1" }, ctx);
  assert.deepEqual(response, [SLIM_REMINDER]);
  assert.deepEqual(called("reminderService.searchReminders"), [[SKILL_AGENT, "cotización", "IN_PROGRESS", "c-1"]]);
});

Deno.test("search_reminders: status como code pasa tal cual (sin consultar el catálogo)", async () => {
  const { ctx, called } = fakeSkillContext();
  await run("search_reminders", { query: "x", status: " DONE " }, ctx);
  assert.deepEqual(called("reminderService.searchReminders"), [[SKILL_AGENT, "x", "DONE", undefined]]);
  assert.equal(called("catalog.reminderStatus.getAll").length, 0);
});

Deno.test("get_upcoming_reminders: sin rango → ventana default de 7 días, cuenta lo de antes y después", async () => {
  const { ctx, called } = fakeSkillContext({ upcoming: [buildReminder()], countAfter: 3, countBefore: [2] });
  const { response, metadata } = await run("get_upcoming_reminders", {}, ctx);
  const r = response as Record<string, unknown>;
  const range = r.queriedRange as Record<string, unknown>;
  assert.equal(range.isDefault, true);
  assert.match(String(range.from), /-06:00$/);
  assert.match(String(range.to), /-06:00$/);
  assert.deepEqual(r.beyondRange, { count: 3 });
  // La ventana default arranca ahora: lo de antes ES lo vencido, sin segunda consulta.
  assert.deepEqual(r.beforeRange, { count: 2, overdue: 2 });
  assert.equal(r.scope, undefined);
  assert.deepEqual(r.reminders, [SLIM_REMINDER]);
  assert.deepEqual(Object.keys(r), ["queriedRange", "beyondRange", "beforeRange", "reminders"]);
  assert.deepEqual(metadata, {
    type: "reminder_list",
    reminders: [{
      id: "r-1",
      title: "Llamar a Julio",
      description: "Dar seguimiento a la cotización",
      dueDate: "2026-12-03T12:00:00-06:00",
      clientName: "Julio Pérez",
    }],
  });
  assert.equal(called("reminderService.countPendingBefore").length, 1);
  const [agentId, from, to, contactId] = called("reminderService.getUpcoming")[0];
  assert.equal(agentId, SKILL_AGENT);
  assert.equal(typeof from, "string");
  assert.equal(typeof to, "string");
  assert.equal(contactId, undefined);
});

Deno.test("get_upcoming_reminders: con contact_id y sin fechas → sin ventana, scope contact, sin conteos", async () => {
  const { ctx, called } = fakeSkillContext({ upcoming: [] });
  const { response } = await run("get_upcoming_reminders", { contact_id: "c-1" }, ctx);
  assert.deepEqual(response, {
    queriedRange: { from: null, to: null },
    scope: "contact",
    reminders: [],
  });
  assert.deepEqual(called("reminderService.getUpcoming"), [[SKILL_AGENT, null, null, "c-1"]]);
  assert.equal(called("reminderService.countPendingAfter").length, 0);
  assert.equal(called("reminderService.countPendingBefore").length, 0);
});

Deno.test("get_upcoming_reminders: ventana en el futuro → separa vencidos con otra consulta", async () => {
  const { ctx, called } = fakeSkillContext({ countBefore: [5, 2] });
  const { response } = await run("get_upcoming_reminders", {
    from: "2099-01-01T00:00:00-06:00",
    to: "2099-01-31T23:59:59-06:00",
  }, ctx);
  const r = response as Record<string, unknown>;
  assert.deepEqual(r.queriedRange, { from: "2099-01-01T00:00:00-06:00", to: "2099-01-31T23:59:59-06:00" });
  assert.deepEqual(r.beforeRange, { count: 5, overdue: 2 });
  assert.equal(r.beyondRange, undefined);
  assert.equal(called("reminderService.countPendingBefore").length, 2);
  assert.deepEqual(called("reminderService.countPendingAfter"), [[SKILL_AGENT, "2099-01-31T23:59:59-06:00", undefined]]);
});

// ─── Ingesta de pólizas: confirmación → recordatorios ───────────────────────

Deno.test("confirm_policy_ingestion: faltan aseguradora/ramo/titular → error sin escribir", async () => {
  const { ctx, called } = fakeSkillContext();
  const { response } = await run("confirm_policy_ingestion", { carrier_name: "GNP" }, ctx);
  assert.deepEqual(response, { error: "Missing required data: carrier_name, branch_name, and holder_name are required." });
  assert.equal(called("policyService.create").length, 0);
});

Deno.test("confirm_policy_ingestion: crea la póliza, liga notas y genera los recordatorios", async () => {
  const created = buildPolicy({ id: "p-new", policyNumber: "GM-77" });
  const generated = [{ id: "rem-1", title: "Pago" }];
  const { ctx, called } = fakeSkillContext({
    createdPolicy: created,
    generatedReminders: generated,
    sessionMetadata: { documentMetadataId: "doc-1" },
    matchingContact: { id: "c-1", fullName: "Julio Pérez" },
    catalogSearch: { carrier: [{ id: "car-1", name: "GNP" }] },
    policyStatuses: [{ id: "st-1", code: "ACTIVE", name: "Active" }],
    currencies: [{ id: "cur-1", code: "MXN", name: "Peso" }],
  });
  const { response, metadata } = await run("confirm_policy_ingestion", {
    carrierName: "GNP",
    branch_name: "Gastos Medicos",
    holder_name: "Julio Pérez",
    policy_number: "GM-77",
    premium: 1000,
    start_date: "2026-01-01",
    beneficiaries: [{ full_name: "Ana", relationship: "Hija", percentage: 100 }],
  }, ctx);

  assert.deepEqual(response, {
    success: true,
    policyId: "p-new",
    policyNumber: "GM-77",
    message: "Policy created successfully.",
  });
  assert.deepEqual(metadata, {
    type: "policy_confirmed",
    policyId: "p-new",
    policyNumber: "GM-77",
    carrierName: "GNP",
    branchName: "Gastos Medicos",
    holderName: "Julio Pérez",
    fieldCount: 6,
    reminders: generated,
  });
  // Aseguradora encontrada; ramo y producto creados (con code derivado del nombre).
  assert.equal(called("catalog.carrier.create").length, 0);
  assert.deepEqual(called("catalog.branch.create"), [[{ name: "Gastos Medicos", code: "GASTOS_MEDICOS" }]]);
  assert.deepEqual(called("catalog.product.create"), [[{ name: "GNP Gastos Medicos", carrierId: "car-1", branchId: "branch-new" }]]);
  assert.deepEqual(called("contactService.findMatchingContact"), [[SKILL_AGENT, "Julio Pérez", null]]);
  const input = called("policyService.create")[0][0] as Record<string, unknown>;
  assert.equal(input.contactId, "c-1");
  assert.equal(input.productId, "product-new");
  assert.equal(input.statusId, "st-1");
  assert.equal(input.currencyId, "cur-1");
  assert.deepEqual(called("policyService.addBeneficiary"), [[{ policyId: "p-new", fullName: "Ana", relationship: "Hija", percentage: 100 }]]);
  assert.deepEqual(called("embeddingsService.updateNoteLinks"), [[SKILL_AGENT, "doc-1", "c-1", "p-new"]]);
  assert.deepEqual(called("reminderGenerationService.generateForPolicy"), [[created, SKILL_AGENT, "-06:00"]]);
  // Sin conflicto de titular no se guarda la nota de trazabilidad.
  assert.equal(called("embeddingsService.saveDocument").length, 0);
});

Deno.test("confirm_policy_ingestion: contacto decidido en pantalla + conflicto → nota de trazabilidad", async () => {
  const created = buildPolicy({ id: "p-new", policyNumber: null });
  const { ctx, called } = fakeSkillContext({
    createdPolicy: created,
    sessionMetadata: { finalContactId: "c-screen", contactMismatchAssignedToScreen: true, detectedContactName: "Otro Señor" },
    policyStatuses: [{ id: "st-1", code: "ACTIVE", name: "Active" }],
    currencies: [{ id: "cur-usd", code: "USD", name: "Dollar" }],
  });
  await run("confirm_policy_ingestion", { carrier_name: "AXA", branch_name: "Vida", holder_name: "X", currency: "USD" }, ctx);
  assert.equal(called("contactService.findMatchingContact").length, 0);
  assert.equal((called("policyService.create")[0][0] as { contactId: string }).contactId, "c-screen");
  assert.equal((called("policyService.create")[0][0] as { currencyId: string }).currencyId, "cur-usd");
  const [agentId, doc] = called("embeddingsService.saveDocument")[0] as [string, Record<string, unknown>];
  assert.equal(agentId, SKILL_AGENT);
  assert.match(String(doc.content), /^This policy \(AXA\) was extracted from a document that identified "Otro Señor"/);
  assert.equal(doc.policyId, "p-new");
  assert.equal(doc.contactId, "c-screen");
  assert.deepEqual(called("aiSessionService.trackEmbeddingUsageOnly"), [[SKILL_AGENT, SKILL_SESSION, null, "test-embedding", 7, 1]]);
});

Deno.test("confirm_policy_ingestion: un throw del service se devuelve como {error}, no como ok:false", async () => {
  const { ctx } = fakeSkillContext({ duplicatePolicies: [{ id: "p-old" }] });
  const { response } = await run("confirm_policy_ingestion", {
    carrier_name: "GNP", branch_name: "GMM", holder_name: "J", policy_number: "GM-1",
  }, ctx);
  assert.deepEqual(Object.keys(response as object), ["error"]);
  assert.match(String((response as { error: string }).error), /GM-1/);
});

Deno.test("update_policy_ingestion: confirmed=false descarta la nota nueva y marca la sesión", async () => {
  const { ctx, called } = fakeSkillContext({ sessionMetadata: { newNoteId: "note-9", foo: 1 } });
  const { response } = await run("update_policy_ingestion", { confirmed: false }, ctx);
  assert.deepEqual(response, { cancelled: true, message: "Update discarded by advisor. Existing policy remains unchanged." });
  assert.deepEqual(called("embeddingsService.softDeleteNoteById"), [[SKILL_AGENT, "note-9", "user_rejected"]]);
  assert.deepEqual(called("aiSessionService.updateMetadata"), [[SKILL_SESSION, { newNoteId: "note-9", foo: 1, status: "update_discarded" }]]);
});

Deno.test("update_policy_ingestion: sin datos en la sesión → error", async () => {
  const { ctx } = fakeSkillContext({ sessionMetadata: {} });
  const { response } = await run("update_policy_ingestion", { confirmed: true }, ctx);
  assert.deepEqual(response, { error: "No update data found in session. Please start a new ingestion." });
});

Deno.test("update_policy_ingestion: aplica la actualización, changelog y respuesta", async () => {
  const updated = buildPolicy({ id: "p-old", policyNumber: "GM-1", contactId: "c-1" });
  const diff = [{ field: "premium", label: "Premium", oldValue: "1", newValue: "2" }];
  const meta = {
    existingPolicyId: "p-old",
    newDocumentMetadataId: "doc-2",
    diff,
    extraction: { carrierName: "GNP", branchName: "GMM", holderName: "Julio", policyNumber: "GM-1", premium: 25000, summary: "s" },
  };
  const { ctx, called } = fakeSkillContext({
    sessionMetadata: meta,
    updatedPolicy: updated,
    policyById: updated,
    catalogSearch: { carrier: [{ id: "car-1" }], branch: [{ id: "br-1" }], product: [{ id: "prod-1" }] },
    policyStatuses: [{ id: "st-1", code: "ACTIVE", name: "Active" }],
    currencies: [{ id: "cur-1", code: "MXN", name: "Peso" }],
  });
  const { response, metadata } = await run("update_policy_ingestion", { confirmed: true }, ctx);
  assert.deepEqual(response, {
    success: true,
    policyId: "p-old",
    policyNumber: "GM-1",
    message: "Policy updated successfully.",
    changesApplied: 1,
  });
  const md = metadata as Record<string, unknown>;
  assert.equal(md.type, "policy_updated");
  assert.equal(md.carrierName, "GNP");
  assert.equal(md.holderName, "Julio");
  assert.equal(md.changesApplied, 1);
  assert.equal(typeof md.remainingDifferences, "number");
  assert.deepEqual(called("embeddingsService.softDeleteNotesByPolicy"), [[SKILL_AGENT, "p-old", "policy"]]);
  assert.deepEqual(called("embeddingsService.updateNoteLinks"), [[SKILL_AGENT, "doc-2", "c-1", "p-old"]]);
  assert.deepEqual(called("aiSessionService.updateMetadata"), [[SKILL_SESSION, { ...meta, status: "update_applied" }]]);
  const [, doc] = called("embeddingsService.saveDocument")[0] as [string, Record<string, unknown>];
  assert.equal(doc.noteOrigin, "policy_changelog");
  assert.equal(doc.summary, "Policy GM-1 updated — 1 field(s) changed.");
});

// ─── Compromisos ────────────────────────────────────────────────────────────

Deno.test("get_commitments: sin filtros → exhaustive y la lista", async () => {
  const { ctx, called } = fakeSkillContext({ commitments: [buildCommitment({ dueFrom: "2026-11-01", dueTo: "2026-11-30" })] });
  const { response } = await run("get_commitments", {}, ctx);
  assert.deepEqual(response, {
    exhaustive: true,
    count: 1,
    commitments: [{
      id: "cm-1",
      contactId: "c-1",
      clientName: "Julio Pérez",
      label: "esperando INE de Julio",
      quote: "Julio me va a mandar su INE",
      dueFrom: "2026-11-01",
      dueTo: "2026-11-30",
    }],
  });
  assert.deepEqual(called("commitmentService.list"), [[SKILL_AGENT, {
    from: undefined, to: undefined, contactId: undefined, query: undefined, overdueOnly: undefined, closedOnly: undefined,
  }]]);
});

Deno.test("get_commitments: vacío por filtros → no exhaustive y qué filtros lo vaciaron", async () => {
  const { ctx } = fakeSkillContext();
  const { response } = await run("get_commitments", { query: "INE", contact_id: "c-1", from: "2026-11-01", overdue_only: true }, ctx);
  assert.deepEqual(response, {
    exhaustive: false,
    emptyBecauseOf: ["query", "contact_id", "the date window", "overdue_only"],
    count: 0,
    commitments: [],
  });
});

Deno.test("get_commitments: closed_only marca los que cerró esta conversación", async () => {
  const { ctx } = fakeSkillContext({
    commitments: [
      buildCommitment({ id: "a", status: "DONE", resolvedBySessionId: SKILL_SESSION }),
      buildCommitment({ id: "b", status: "DONE", resolvedBySessionId: "otra" }),
    ],
  });
  const { response } = await run("get_commitments", { closed_only: true }, ctx);
  const list = (response as { commitments: Record<string, unknown>[] }).commitments;
  assert.equal(list[0].closedByYouInThisConversation, true);
  assert.equal("closedByYouInThisConversation" in list[1], false);
});

Deno.test("close_commitment: los tres desenlaces", async () => {
  const notFound = fakeSkillContext({ closeResult: { outcome: "not_found" } });
  assert.deepEqual((await run("close_commitment", { commitment_id: "cm-1" }, notFound.ctx)).response, {
    error: "No commitment found with that id for this advisor.",
  });

  const already = fakeSkillContext({ closeResult: { outcome: "already_closed", commitment: buildCommitment({ status: "DONE" }) } });
  assert.deepEqual((await run("close_commitment", { commitment_id: "cm-1" }, already.ctx)).response, {
    alreadyClosed: true,
    label: "esperando INE de Julio",
  });

  const closed = fakeSkillContext({
    closeResult: { outcome: "closed", commitment: buildCommitment({ status: "DISMISSED", resolutionNote: "ya no aplica" }) },
  });
  assert.deepEqual(
    (await run("close_commitment", { commitment_id: "cm-1", dismissed: true, resolution_note: "ya no aplica" }, closed.ctx)).response,
    { id: "cm-1", label: "esperando INE de Julio", status: "DISMISSED", resolutionNote: "ya no aplica" },
  );
  assert.deepEqual(closed.called("commitmentService.close"), [[SKILL_AGENT, "cm-1", "DISMISSED", "ya no aplica", SKILL_SESSION]]);
});

Deno.test("update_commitment: solo el id → ok:false con su mensaje propio", async () => {
  const { ctx, called } = fakeSkillContext();
  const { response } = await run("update_commitment", { commitment_id: "cm-1" }, ctx);
  assert.deepEqual(response, { ok: false, error: "update_commitment received no field to change." });
  assert.equal(called("commitmentService.update").length, 0);
});

Deno.test("create_commitment: pasa las palabras del asesor y avisa que no suena", async () => {
  const { ctx, called } = fakeSkillContext({ commitments: [buildCommitment()] });
  const { response } = await run("create_commitment", { label: "esperando INE de Julio", quote: "me va a mandar su INE" }, ctx);
  assert.deepEqual(response, {
    id: "cm-1",
    label: "esperando INE de Julio",
    clientName: "Julio Pérez",
    dueFrom: null,
    dueTo: null,
    ringsAnAlarm: false,
  });
  assert.equal((called("commitmentService.create")[0][1] as { source: string }).source, "lo que escribió el asesor");
});

// ─── Listas vacías: sin tarjeta (el modelo conserva su respuesta) ───────────

Deno.test("get_upcoming_reminders: agenda vacía → sin tarjeta, el modelo sigue viendo la ventana", async () => {
  const { ctx } = fakeSkillContext({ upcoming: [] });
  const { response, metadata } = await run("get_upcoming_reminders", {}, ctx);
  assert.equal(metadata, undefined);
  assert.deepEqual((response as Record<string, unknown>).reminders, []);
  assert.ok((response as Record<string, unknown>).queriedRange);
});

Deno.test("get_contact_policies: sin pólizas → sin tarjeta policy_list", async () => {
  const { ctx } = fakeSkillContext({ policiesByContact: { "c-1": [] } });
  const { response, metadata } = await run("get_contact_policies", { contact_id: "c-1" }, ctx);
  assert.equal(metadata, undefined);
  assert.deepEqual((response as Record<string, unknown>).policies, []);
});

// ─── widen_if_empty ─────────────────────────────────────────────────────────

/** getUpcoming falso que responde según si hay rango (null/null = búsqueda ampliada). */
function withWiden(wide: ReturnType<typeof buildReminder>[], ranged: ReturnType<typeof buildReminder>[] = []) {
  const f = fakeSkillContext({ upcoming: ranged });
  // deno-lint-ignore no-explicit-any
  const rs = f.ctx.reminderService as any;
  const orig = rs.getUpcoming;
  const wideCalls: unknown[][] = [];
  rs.getUpcoming = (a: string, from: string | null, to: string | null, c?: string) =>
    from === null && to === null ? (wideCalls.push([a, c]), Promise.resolve(wide)) : orig(a, from, to, c);
  return { ...f, wideCalls };
}

const RANGE = { from: "2099-01-01T00:00:00-06:00", to: "2099-01-01T23:59:59-06:00", contact_id: "c-1" };

Deno.test("widen_if_empty: ausente o false → igual que hoy (sin ampliar)", async () => {
  for (const extra of [{}, { widen_if_empty: false }]) {
    const { ctx, wideCalls } = withWiden([buildReminder()]);
    const { response } = await run("get_upcoming_reminders", { ...RANGE, ...extra }, ctx);
    const r = response as Record<string, unknown>;
    assert.equal(r.widened, undefined);
    assert.deepEqual(r.reminders, []);
    assert.equal(wideCalls.length, 0);
  }
});

Deno.test("widen_if_empty: true y el rango tiene resultados → no amplía", async () => {
  const { ctx, wideCalls } = withWiden([buildReminder({ id: "r-x" })], [buildReminder()]);
  const { response, metadata } = await run("get_upcoming_reminders", { ...RANGE, widen_if_empty: true }, ctx);
  const r = response as Record<string, unknown>;
  assert.equal(r.widened, undefined);
  assert.deepEqual(r.reminders, [SLIM_REMINDER]);
  assert.equal(wideCalls.length, 0);
  assert.ok(metadata);
});

Deno.test("widen_if_empty: true y rango vacío → trae futuros y vencidos del contacto, con widened y rango pedido", async () => {
  const overdue = buildReminder({ id: "r-old", dueDate: "2020-01-01T12:00:00Z" });
  const future = buildReminder({ id: "r-far", dueDate: "2099-06-01T12:00:00Z" });
  const { ctx, wideCalls } = withWiden([overdue, future]);
  const { response, metadata } = await run("get_upcoming_reminders", { ...RANGE, widen_if_empty: true }, ctx);
  const r = response as Record<string, unknown>;
  assert.equal(r.widened, true);
  assert.deepEqual(r.queriedRange, { from: RANGE.from, to: RANGE.to });
  assert.equal(r.scope, "contact");
  assert.deepEqual((r.reminders as { id: string }[]).map((x) => x.id), ["r-old", "r-far"]);
  assert.equal(r.beyondRange, undefined);
  assert.equal(r.beforeRange, undefined);
  assert.equal((metadata as { reminders: unknown[] }).reminders.length, 2);
  assert.deepEqual(wideCalls, [[SKILL_AGENT, "c-1"]]);
});

Deno.test("widen_if_empty: nada en ningún lado → widened + vacío, sin tarjeta", async () => {
  const { ctx } = withWiden([]);
  const { response, metadata } = await run("get_upcoming_reminders", { ...RANGE, widen_if_empty: true }, ctx);
  const r = response as Record<string, unknown>;
  assert.equal(r.widened, true);
  assert.deepEqual(r.reminders, []);
  assert.equal(metadata, undefined);
});

Deno.test("widen_if_empty: sin contact_id → la lista ampliada se recorta al tope", async () => {
  const many = Array.from({ length: 35 }, (_, i) => buildReminder({ id: `r-${i}` }));
  const { ctx } = withWiden(many);
  const { response } = await run("get_upcoming_reminders", { from: RANGE.from, to: RANGE.to, widen_if_empty: true }, ctx);
  const r = response as Record<string, unknown>;
  assert.equal(r.widened, true);
  assert.equal(r.truncated, true);
  assert.equal((r.reminders as unknown[]).length, 20);
  assert.equal(r.scope, undefined);
});
