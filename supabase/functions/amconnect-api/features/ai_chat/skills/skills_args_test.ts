// Manejo de argumentos de las skills a través de `executeSkill` (el mismo
// camino que usan el chat de texto y la voz): validación Zod, umbral del RAG
// según haya id de entidad o no, y que una actualización vacía no se confirme.
//
// test_env va primero: el registro de skills importa módulos que leen config.
import "../../../shared/testing/test_env.ts";
import assert from "node:assert/strict";
import { executeSkill } from "./skill_executor.ts";
import type { SkillContext } from "./skill.core.ts";
import { RAG_THRESHOLD_ENTITY_UNSCOPED, RAG_THRESHOLD_SCOPED } from "../../rag/rag.service.ts";
import { NotFoundError } from "../../../shared/errors.ts";
import type { ReminderResponseDTO } from "../../../modules/reminder/reminder.dto.ts";
import { reminderSkills } from "./reminder.skills.ts";
import { getSkillsByDomains } from "./index.ts";
import { withRealWorkflows } from "../../../shared/testing/skill_workflows.ts";

const AGENT = "agent-1";
const UUID = "3f1c2a8e-5b7d-4e19-9a0c-2d6f8b1e4c37";

interface Calls {
  search: Array<{ agentId: string; query: string; options: Record<string, unknown> }>;
  reminderUpdates: Array<{ id: string; changes: Record<string, unknown> }>;
  policyUpdates: Array<{ id: string; changes: Record<string, unknown> }>;
  expiring: Array<{ agentId: string; from: string; to: string }>;
}

// Solo los services que tocan estas skills; el resto no existe a propósito:
// si una skill llamara a otro, la prueba truena en vez de pasar en silencio.
function fakeCtx(reminders: Record<string, ReminderResponseDTO> = {}): { ctx: SkillContext; calls: Calls } {
  const calls: Calls = { search: [], reminderUpdates: [], policyUpdates: [], expiring: [] };
  const ctx = {
    agentId: AGENT,
    sessionId: "session-1",
    timezone: "America/Mexico_City",
    timezoneOffset: "-06:00",
    ragService: {
      searchNotes: (agentId: string, query: string, options: Record<string, unknown>) => {
        calls.search.push({ agentId, query, options });
        return Promise.resolve([]);
      },
    },
    reminderService: {
      update: (id: string, changes: Record<string, unknown>) => {
        calls.reminderUpdates.push({ id, changes });
        return Promise.resolve(reminders[id] ? { ...reminders[id], ...changes } : null);
      },
      // Como el repositorio real: sin fila visible (otro asesor por RLS, o no existe) lanza 404.
      getById: (id: string) => reminders[id] ? Promise.resolve(reminders[id]) : Promise.reject(new NotFoundError()),
    },
    // Un estado por UUID se busca en el catálogo para saber si es cancelar.
    catalogServices: { reminderStatusService: { getAll: () => Promise.resolve([]) } },
    policyService: {
      getExpiringBetween: (agentId: string, from: string, to: string) => {
        calls.expiring.push({ agentId, from, to });
        return Promise.resolve([]);
      },
      update: (id: string, changes: Record<string, unknown>) => {
        calls.policyUpdates.push({ id, changes });
        return Promise.resolve(null);
      },
      getById: () => Promise.resolve({ notes: null }),
    },
  } as unknown as SkillContext;
  // Las reglas de las skills viven en los workflow services; se montan los
  // reales sobre estos fakes, así que las aserciones sobre `reminderService` y
  // `policyService` siguen viendo exactamente lo mismo que antes del refactor.
  return { ctx: withRealWorkflows(ctx), calls };
}

function quiet<T>(fn: () => Promise<T>): Promise<T> {
  const { warn, error } = console;
  console.warn = () => {};
  console.error = () => {};
  return fn().finally(() => {
    console.warn = warn;
    console.error = error;
  });
}

// ─── Umbral del RAG: entityThreshold ────────────────────────────────────────

const NOTE_SKILLS: Array<[string, string, string]> = [
  ["search_contact_notes", "contact_id", "contactId"],
  ["search_policy_notes", "policy_id", "policyId"],
  ["search_reminder_notes", "reminder_id", "reminderId"],
];

for (const [skill, idArg, idOption] of NOTE_SKILLS) {
  Deno.test(`${skill}: con ${idArg} busca acotado con umbral ${RAG_THRESHOLD_SCOPED}`, async () => {
    const { ctx, calls } = fakeCtx();
    await quiet(() => executeSkill(skill, { query: "¿qué me dijo de su mamá?", [idArg]: UUID }, ctx));
    assert.equal(calls.search.length, 1);
    assert.equal(calls.search[0].agentId, AGENT);
    assert.equal(calls.search[0].options[idOption], UUID);
    assert.equal(calls.search[0].options.threshold, RAG_THRESHOLD_SCOPED);
  });

  Deno.test(`${skill}: sin ${idArg} usa el umbral estricto ${RAG_THRESHOLD_ENTITY_UNSCOPED}`, async () => {
    const { ctx, calls } = fakeCtx();
    await quiet(() => executeSkill(skill, { query: "coberturas" }, ctx));
    assert.equal(calls.search[0].options[idOption], undefined);
    assert.equal(calls.search[0].options.threshold, RAG_THRESHOLD_ENTITY_UNSCOPED);
  });

  Deno.test(`${skill}: sin query responde el dato faltante y no busca`, async () => {
    const { ctx, calls } = fakeCtx();
    const { response } = await quiet(() => executeSkill(skill, { [idArg]: UUID }, ctx));
    assert.match(String((response as { error: string }).error), /^Missing required data — query:/);
    assert.equal(calls.search.length, 0);
  });
}

Deno.test("executeSkill: skill desconocida → error para el modelo, sin lanzar", async () => {
  const { ctx } = fakeCtx();
  const { response } = await executeSkill("delete_everything", {}, ctx);
  assert.deepEqual(response, { error: "Unknown skill: delete_everything" });
});

// ─── update_reminder ────────────────────────────────────────────────────────

Deno.test("update_reminder: solo el id (nada que cambiar) → ok:false y no escribe", async () => {
  const { ctx, calls } = fakeCtx();
  const { response } = await quiet(() => executeSkill("update_reminder", { reminder_id: UUID, title: "  " }, ctx));
  assert.equal((response as { ok: boolean }).ok, false);
  assert.match(String((response as { error: string }).error), /Nothing to update/);
  assert.equal(calls.reminderUpdates.length, 0);
});

Deno.test("update_reminder: cancelar sin comentario se rechaza", async () => {
  const { ctx, calls } = fakeCtx();
  const { response } = await quiet(() => executeSkill("update_reminder", { reminder_id: UUID, status: "CANCELLED" }, ctx));
  assert.match(String((response as { error: string }).error), /comment is mandatory/);
  assert.equal(calls.reminderUpdates.length, 0);
});

Deno.test("update_reminder: status como code va a `status`; como UUID va a `statusId`", async () => {
  const { ctx, calls } = fakeCtx();
  await quiet(() => executeSkill("update_reminder", { reminder_id: UUID, status: "IN_PROGRESS" }, ctx));
  await quiet(() => executeSkill("update_reminder", { reminder_id: UUID, status: UUID }, ctx));
  assert.equal(calls.reminderUpdates[0].changes.status, "IN_PROGRESS");
  assert.equal(calls.reminderUpdates[0].changes.statusId, undefined);
  assert.equal(calls.reminderUpdates[1].changes.status, undefined);
  assert.equal(calls.reminderUpdates[1].changes.statusId, UUID);
});

Deno.test("update_reminder: un comentario solo cuenta como cambio", async () => {
  const { ctx, calls } = fakeCtx();
  await quiet(() => executeSkill("update_reminder", { reminder_id: UUID, comment: "Ya le llamé" }, ctx));
  assert.equal(calls.reminderUpdates.length, 1);
  assert.equal(calls.reminderUpdates[0].changes.comment, "Ya le llamé");
});

Deno.test("update_reminder: sin reminder_id falla la validación antes de ejecutar", async () => {
  const { ctx, calls } = fakeCtx();
  const { response } = await quiet(() => executeSkill("update_reminder", { title: "Llamar" }, ctx));
  assert.match(String((response as { error: string }).error), /reminder_id/);
  assert.equal(calls.reminderUpdates.length, 0);
});

// ─── update_policy ──────────────────────────────────────────────────────────

Deno.test("update_policy: solo el id → ok:false y no escribe", async () => {
  const { ctx, calls } = fakeCtx();
  const { response } = await quiet(() => executeSkill("update_policy", { policy_id: UUID }, ctx));
  assert.equal((response as { ok: boolean }).ok, false);
  assert.equal(calls.policyUpdates.length, 0);
});

Deno.test("update_policy: convierte snake_case a camelCase y no manda el id como campo", async () => {
  const { ctx, calls } = fakeCtx();
  await quiet(() =>
    executeSkill("update_policy", { policy_id: UUID, premium: 1200, next_payment_date: "2026-12-01" }, ctx)
  );
  assert.equal(calls.policyUpdates[0].id, UUID);
  assert.deepEqual(calls.policyUpdates[0].changes, { premium: 1200, nextPaymentDate: "2026-12-01" });
});

Deno.test("update_policy: policy_id que no es UUID se rechaza en la validación", async () => {
  const { ctx, calls } = fakeCtx();
  const { response } = await quiet(() => executeSkill("update_policy", { policy_id: "GM-0001", premium: 1 }, ctx));
  assert.match(String((response as { error: string }).error), /^Missing required data — policy_id/);
  assert.equal(calls.policyUpdates.length, 0);
});

// ─── get_expiring_policies: rango de fechas ─────────────────────────────────

const plusDays = (from: string, n: number) =>
  new Date(new Date(`${from}T00:00:00Z`).getTime() + n * 86400000).toISOString().slice(0, 10);

Deno.test("get_expiring_policies: sin args → hoy (fecha local) + 30 días, filtrado en el service", async () => {
  const { ctx, calls } = fakeCtx();
  await quiet(() => executeSkill("get_expiring_policies", {}, ctx));
  assert.equal(calls.expiring.length, 1);
  const { agentId, from, to } = calls.expiring[0];
  assert.equal(agentId, AGENT);
  assert.match(from, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(to, plusDays(from, 30));
});

Deno.test("get_expiring_policies: days sigue funcionando (compatibilidad)", async () => {
  const { ctx, calls } = fakeCtx();
  await quiet(() => executeSkill("get_expiring_policies", { days: 7 }, ctx));
  const { from, to } = calls.expiring[0];
  assert.equal(to, plusDays(from, 7));
});

Deno.test("get_expiring_policies: from_date + to_date se pasan tal cual (mes siguiente)", async () => {
  const { ctx, calls } = fakeCtx();
  await quiet(() => executeSkill("get_expiring_policies", { from_date: "2026-12-01", to_date: "2026-12-31" }, ctx));
  assert.deepEqual(calls.expiring, [{ agentId: AGENT, from: "2026-12-01", to: "2026-12-31" }]);
});

Deno.test("get_expiring_policies: solo from_date → from + days; to_date gana sobre days", async () => {
  const { ctx, calls } = fakeCtx();
  await quiet(() => executeSkill("get_expiring_policies", { from_date: "2027-01-01", days: 10 }, ctx));
  await quiet(() => executeSkill("get_expiring_policies", { from_date: "2027-01-01", to_date: "2027-03-01", days: 10 }, ctx));
  assert.deepEqual(calls.expiring.map((c) => [c.from, c.to]), [["2027-01-01", "2027-01-11"], ["2027-01-01", "2027-03-01"]]);
});

Deno.test("get_expiring_policies: rango inválido (to < from, fecha mal formada, demasiado largo) no consulta", async () => {
  const { ctx, calls } = fakeCtx();
  for (
    const args of [
      { from_date: "2026-12-31", to_date: "2026-12-01" },
      { from_date: "31/12/2026" },
      { from_date: "2026-13-45" },
      { from_date: "2026-01-01", to_date: "2040-01-01" },
      { days: 5000 },
      { to_date: "2020-01-01" }, // sin from_date el inicio es hoy: rango al revés
    ]
  ) {
    const { response } = await quiet(() => executeSkill("get_expiring_policies", args, ctx));
    assert.ok((response as { error?: string }).error, JSON.stringify(args));
  }
  assert.equal(calls.expiring.length, 0);
});

// ─── reschedule_reminder ────────────────────────────────────────────────────

const REM_ID = "9b2d7c41-0a5e-4f63-8d1b-7e3a5c9f2b10";
const remAt = (dueDate: string): ReminderResponseDTO => ({ id: REM_ID, title: "Cita", dueDate } as ReminderResponseDTO);
const reschedule = (args: Record<string, unknown>, reminders: Record<string, ReminderResponseDTO>, timezone?: string) => {
  const { ctx, calls } = fakeCtx(reminders);
  if (timezone) (ctx as { timezone: string }).timezone = timezone;
  return quiet(() => executeSkill("reschedule_reminder", args, ctx)).then(({ response, metadata }) => ({ response, metadata, calls }));
};

Deno.test("reschedule_reminder: está en el dominio reminder", () => {
  const names = getSkillsByDomains(["reminder"]).map((s) => s.declaration.name);
  assert.ok(names.includes("reschedule_reminder"));
  assert.ok(reminderSkills.some((s) => s.declaration.name === "reschedule_reminder" && s.domain === "reminder"));
});

Deno.test("reschedule_reminder: validación de reminder_id, new_date y new_time", async () => {
  for (
    const bad of [
      {},
      { reminder_id: "no-uuid", new_date: "2026-12-01" },
      { reminder_id: REM_ID, new_date: "01/12/2026" },
      { reminder_id: REM_ID, new_date: "2026-02-30" },
      { reminder_id: REM_ID, new_date: "2026-12-01", new_time: "25:00" },
      { reminder_id: REM_ID, new_date: "2026-12-01", new_time: "5pm" },
    ]
  ) {
    const { response, calls } = await reschedule(bad, { [REM_ID]: remAt("2026-11-23T23:00:00+00:00") });
    assert.match(String((response as { error: string }).error), /^Missing required data/);
    assert.equal(calls.reminderUpdates.length, 0);
  }
});

Deno.test("reschedule_reminder: sin new_time conserva la hora local original", async () => {
  // 23:00 UTC = 17:00 en Ciudad de México (UTC-6)
  const { response, calls } = await reschedule({ reminder_id: REM_ID, new_date: "2026-12-01" }, { [REM_ID]: remAt("2026-11-23T23:00:00+00:00") });
  assert.equal(calls.reminderUpdates.length, 1);
  assert.deepEqual(calls.reminderUpdates[0].changes, { dueDate: "2026-12-01T17:00:00-06:00" });
  assert.equal((response as { id: string }).id, REM_ID);
  assert.equal((response as { dueDate: string }).dueDate, "2026-12-01T17:00:00-06:00");
});

Deno.test("reschedule_reminder: new_time explícito gana", async () => {
  const { calls } = await reschedule(
    { reminder_id: REM_ID, new_date: "2026-12-01", new_time: "9:30" },
    { [REM_ID]: remAt("2026-11-23T23:00:00+00:00") },
  );
  assert.deepEqual(calls.reminderUpdates[0].changes, { dueDate: "2026-12-01T09:30:00-06:00" });
});

Deno.test("reschedule_reminder: recordatorio de solo fecha (medianoche local) sigue de solo fecha", async () => {
  const { calls } = await reschedule({ reminder_id: REM_ID, new_date: "2026-12-05" }, { [REM_ID]: remAt("2026-11-23T06:00:00+00:00") });
  assert.deepEqual(calls.reminderUpdates[0].changes, { dueDate: "2026-12-05T00:00:00-06:00" });
});

Deno.test("reschedule_reminder: no existe → ok:false, no escribe y nunca crea", async () => {
  const { response, calls } = await reschedule({ reminder_id: REM_ID, new_date: "2026-12-01" }, {});
  assert.equal((response as { ok: boolean }).ok, false);
  assert.match(String((response as { error: string }).error), /No reminder/);
  assert.equal(calls.reminderUpdates.length, 0);
});

Deno.test("reschedule_reminder: recordatorio ajeno (RLS no lo devuelve) → igual que no existe", async () => {
  const OTHER = "11111111-2222-4333-8444-555555555555";
  const { response, calls } = await reschedule({ reminder_id: OTHER, new_date: "2026-12-01" }, { [REM_ID]: remAt("2026-11-23T23:00:00+00:00") });
  assert.equal((response as { ok: boolean }).ok, false);
  assert.equal(calls.reminderUpdates.length, 0);
});

Deno.test("reschedule_reminder: sin new_date ni new_time → error claro para el modelo, no escribe", async () => {
  const { response, calls } = await reschedule({ reminder_id: REM_ID }, { [REM_ID]: remAt("2026-11-23T23:00:00+00:00") });
  assert.equal((response as { ok: boolean }).ok, false);
  assert.match(String((response as { error: string }).error), /^Send new_date, new_time or both: at least one is required/);
  assert.equal(calls.reminderUpdates.length, 0);
});

Deno.test("reschedule_reminder: solo new_time conserva el día local original", async () => {
  // 23:00 UTC del 23 = 17:00 del 23 en CDMX; "a las 6" → 18:00 el mismo día
  const { calls } = await reschedule({ reminder_id: REM_ID, new_time: "18:00" }, { [REM_ID]: remAt("2026-11-23T23:00:00+00:00") });
  assert.deepEqual(calls.reminderUpdates[0].changes, { dueDate: "2026-11-23T18:00:00-06:00" });
});

Deno.test("reschedule_reminder: solo new_time usa el día LOCAL, no el día UTC", async () => {
  // 03:00 UTC del 24 = 21:00 del 23 en CDMX
  const { calls } = await reschedule({ reminder_id: REM_ID, new_time: "22:00" }, { [REM_ID]: remAt("2026-11-24T03:00:00+00:00") });
  assert.deepEqual(calls.reminderUpdates[0].changes, { dueDate: "2026-11-23T22:00:00-06:00" });
});

Deno.test("reschedule_reminder: solo new_time en día de cambio de horario (DST) toma el offset de ese día", async () => {
  const NY = "America/New_York";
  // 12:00 UTC del 8 mar 2026 = 08:00 EDT (el horario de verano arrancó a las 02:00 locales)
  const edt = { [REM_ID]: remAt("2026-03-08T12:00:00+00:00") };
  assert.deepEqual((await reschedule({ reminder_id: REM_ID, new_time: "09:00" }, edt, NY)).calls.reminderUpdates[0].changes, { dueDate: "2026-03-08T09:00:00-04:00" });
  assert.deepEqual((await reschedule({ reminder_id: REM_ID, new_time: "01:00" }, edt, NY)).calls.reminderUpdates[0].changes, { dueDate: "2026-03-08T01:00:00-05:00" });
  // 04:30 UTC del 8 mar = 23:30 EST del 7: el día local es el 7, no el 8
  const est = { [REM_ID]: remAt("2026-03-08T04:30:00+00:00") };
  assert.deepEqual((await reschedule({ reminder_id: REM_ID, new_time: "10:00" }, est, NY)).calls.reminderUpdates[0].changes, { dueDate: "2026-03-07T10:00:00-05:00" });
});

Deno.test("reschedule_reminder: la tarjeta final lleva el recordatorio ya movido (reminder_list), no la hora vieja", async () => {
  const { response, metadata } = await reschedule({ reminder_id: REM_ID, new_time: "18:00" }, { [REM_ID]: remAt("2026-11-23T23:00:00+00:00") });
  assert.deepEqual(metadata, {
    type: "reminder_list",
    reminders: [{ id: REM_ID, title: "Cita", description: undefined, dueDate: "2026-11-23T18:00:00-06:00", clientName: null }],
  });
  // Al modelo no le llega la metadata, solo el recordatorio recortado.
  assert.equal("__skillMetadata" in (response as object), false);
  assert.equal((response as { dueDate: string }).dueDate, "2026-11-23T18:00:00-06:00");
});

Deno.test("reschedule_reminder: la respuesta al modelo lleva movedFrom (fecha local anterior) en solo fecha, solo hora y ambos", async () => {
  // 23:00 UTC del 27 = 17:00 del 27 en CDMX
  const rem = { [REM_ID]: remAt("2026-11-27T23:00:00+00:00") };
  const dateOnly = await reschedule({ reminder_id: REM_ID, new_date: "2026-11-24" }, rem);
  assert.equal((dateOnly.response as { movedFrom: string }).movedFrom, "2026-11-27T17:00:00-06:00");
  assert.equal((dateOnly.response as { dueDate: string }).dueDate, "2026-11-24T17:00:00-06:00");
  const timeOnly = await reschedule({ reminder_id: REM_ID, new_time: "10:00" }, rem);
  assert.equal((timeOnly.response as { movedFrom: string }).movedFrom, "2026-11-27T17:00:00-06:00");
  const both = await reschedule({ reminder_id: REM_ID, new_date: "2026-11-24", new_time: "10:00" }, rem);
  assert.equal((both.response as { movedFrom: string }).movedFrom, "2026-11-27T17:00:00-06:00");
  assert.equal((both.response as { dueDate: string }).dueDate, "2026-11-24T10:00:00-06:00");
  // La tarjeta no cambia: movedFrom no va en la metadata.
  assert.equal("movedFrom" in (both.metadata as object), false);
  const decl = reminderSkills.find((s) => s.declaration.name === "reschedule_reminder")!.declaration.description;
  assert.match(decl, /ALWAYS state both dates/);
});

Deno.test("update_reminder y mark_reminder_done: la tarjeta refleja el recordatorio cambiado", async () => {
  const { ctx } = fakeCtx({ [REM_ID]: remAt("2026-11-23T23:00:00+00:00") });
  for (const [name, args] of [["update_reminder", { reminder_id: REM_ID, title: "Cita nueva" }], ["mark_reminder_done", { reminder_id: REM_ID }]] as const) {
    const { metadata } = await quiet(() => executeSkill(name, args, ctx));
    assert.equal((metadata as { type: string }).type, "reminder_list", name);
    assert.equal((metadata as { reminders: unknown[] }).reminders.length, 1, name);
  }
});
