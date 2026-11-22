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
function fakeCtx(): { ctx: SkillContext; calls: Calls } {
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
        return Promise.resolve(null);
      },
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
