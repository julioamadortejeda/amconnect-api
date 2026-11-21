/**
 * Corre los selects con embeds REALES de los repositorios contra el PostgREST
 * local, con el JWT de un asesor real, y truena si alguno falla.
 *
 * Por qué existe: el 2026-11-21 la migración tenant_integrity agregó FKs
 * compuestas junto a las simples. Para Postgres no había problema, pero
 * PostgREST vio dos relaciones entre el mismo par de tablas y todo embed sin
 * hint respondió PGRST201: GET /reminders y GET /policies en 500 y el asistente
 * sin poder leer recordatorios. Ni pgTAP ni los tests de Deno (con fakes) pasan
 * por PostgREST, así que nadie lo vio hasta integración.
 *
 * Usa los repositorios de verdad (no copias de sus selects): si alguien cambia
 * un select o un hint, esto prueba el string nuevo.
 *
 * Requiere el stack local arriba (`supabase start`) y un asesor con datos:
 *   EMBED_CHECK_EMAIL=asesor@example.com EMBED_CHECK_PASSWORD=... \
 *     deno run -A --config supabase/functions/amconnect-api/deno.json scripts/check_postgrest_embeds.ts
 */

import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { ReminderRepository } from "../supabase/functions/amconnect-api/modules/reminder/reminder.repository.ts";
import { PolicyRepository } from "../supabase/functions/amconnect-api/modules/policy/policy.repository.ts";
import { NoteRepository } from "../supabase/functions/amconnect-api/modules/note/note.repository.ts";
import { CommitmentRepository } from "../supabase/functions/amconnect-api/features/commitments/commitment.repository.ts";
import { ReminderGenerationRepository } from "../supabase/functions/amconnect-api/modules/reminder/reminder_generation.repository.ts";
import { ReminderGenerationJobRepository } from "../supabase/functions/amconnect-api/features/reminder_generation/reminder_generation_job.repository.ts";
import { createCatalogServices } from "../supabase/functions/amconnect-api/modules/catalog/catalog.service.ts";

function requireEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) {
    console.error(`[EMBEDS] falta ${name}`);
    Deno.exit(2);
  }
  return v;
}

async function localStack(): Promise<{ url: string; anon: string }> {
  const out = await new Deno.Command("supabase", { args: ["status", "-o", "json"], stderr: "null" }).output();
  const status = JSON.parse(new TextDecoder().decode(out.stdout));
  return { url: status.API_URL, anon: status.ANON_KEY };
}

const { url, anon } = await localStack();
const auth = createClient(url, anon, { auth: { persistSession: false } });
const { data: login, error: loginError } = await auth.auth.signInWithPassword({
  email: requireEnv("EMBED_CHECK_EMAIL"),
  password: requireEnv("EMBED_CHECK_PASSWORD"),
});
if (loginError || !login.session) {
  console.error("[EMBEDS] no se pudo iniciar sesión:", loginError?.message);
  Deno.exit(2);
}
const agentId = login.user.id;
// Igual que auth.middleware: cliente con el JWT del asesor, RLS activo.
const supabase: SupabaseClient = createClient(url, anon, {
  auth: { persistSession: false },
  global: { headers: { Authorization: `Bearer ${login.session.access_token}` } },
});

let failed = 0;
async function check<T>(label: string, fn: () => Promise<T>): Promise<T | undefined> {
  try {
    const r = await fn();
    const n = Array.isArray(r) ? r.length : r && typeof r === "object" && "data" in r
      ? (r as { data: unknown[] }).data?.length
      : r ? 1 : 0;
    console.log(`ok    ${label} (${n})`);
    return r;
  } catch (e) {
    failed++;
    const err = e as { internal?: string; message?: string };
    console.log(`FALLA ${label}: ${err.internal ?? err.message}`);
    return undefined;
  }
}

const reminders = new ReminderRepository(supabase);
const policies = new PolicyRepository(supabase);
const notes = new NoteRepository(supabase);

const reminderPage = await check("reminders: listado (GET /reminders)", () => reminders.paginate({}, 1, 5));
const reminderId = (reminderPage?.data?.[0] as { id?: string } | undefined)?.id;
if (reminderId) {
  await check("reminders: detalle (GET /reminders/:id)", () => reminders.getById(reminderId));
  await check("notes: por recordatorio", () => notes.getByReminderId(reminderId));
}
await check("reminders: búsqueda (skill)", () => reminders.searchReminders(agentId, "pago"));
await check("reminders: próximos (skill)", () =>
  reminders.getUpcomingReminders(agentId, new Date(Date.now() - 30 * 864e5).toISOString(), new Date(Date.now() + 30 * 864e5).toISOString(), []));

const policyPage = await check("policies: listado (GET /policies)", () => policies.paginate({}, 1, 5));
const policy = policyPage?.data?.[0] as { id?: string; contact_id?: string } | undefined;
if (policy?.id) {
  await check("policies: detalle", () => policies.getById(policy.id!));
  await check("policies: por ids (skill)", () => policies.getByIds([policy.id!]));
  await check("notes: por póliza", () => notes.getByPolicyId(policy.id!));
  await check("reminder_generation: datos de calendario de la póliza", () =>
    new ReminderGenerationRepository(supabase).findPolicyScheduleInfo(policy.id!));
}
if (policy?.contact_id) {
  await check("policies: de un contacto (GET /contacts/:id/policies)", () =>
    policies.findByFilters({ contact_id: policy.contact_id }));
  await check("notes: por contacto", () => notes.getByContactId(policy.contact_id!));
}

await check("notes: adjuntos de RAG (agent_notes -> document_metadata)", async () => {
  const { data, error } = await supabase.from("agent_notes")
    .select("id, document_metadata(storage_path, file_name)").limit(5);
  if (error) throw new Error(`${error.code}: ${error.message}`);
  return data;
});
await check("notes: recientes", () => notes.searchNotes(5, 0));
await check("commitments: listado", () => new CommitmentRepository(supabase as never).list(agentId, {}));
await check("catálogo: productos con aseguradora y ramo", () =>
  createCatalogServices(supabase, agentId).productService.getWithRelations());
const job = new ReminderGenerationJobRepository(supabase);
await check("cron: pólizas activas (hints !inner)", () => job.findActivePolicies(0, 5));
await check("cron: contactos con cumpleaños", () => job.findContactsWithBirthdate(0, 5));

if (failed > 0) {
  console.error(`\n[EMBEDS] ${failed} select(s) fallaron contra PostgREST`);
  Deno.exit(1);
}
console.log("\n[EMBEDS] todos los selects con embeds responden");
