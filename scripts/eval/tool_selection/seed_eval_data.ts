// Siembra datos de prueba para el eval de selección de herramientas, en el backend LOCAL.
// Ver README.md. Idempotente: todo lo sembrado lleva la marca "eval-seed"; cada corrida
// borra (soft delete) lo marcado y lo vuelve a crear. NO correr contra producción.
//
//   deno run scripts/eval/tool_selection/seed_eval_data.ts --dry-run   (sin red ni variables)
//   deno run -A scripts/eval/tool_selection/seed_eval_data.ts
//   deno run -A scripts/eval/tool_selection/seed_eval_data.ts --cleanup
//
// Variables: EVAL_BASE_URL, EVAL_ANON_KEY, EVAL_EMAIL, EVAL_PASSWORD (las mismas de run_eval.ts).
// Contactos, recordatorios y notas se crean por la API HTTP del backend (las notas se
// embeben igual que en producción). Los compromisos no tienen endpoint de creación (nacen
// en el asistente), así que se insertan por PostgREST con el JWT del asesor (RLS).
import { monterreyIso } from "./lib.ts";

const TAG = "eval-seed";

// ─── Plan de datos ──────────────────────────────────────────────────────────

interface ContactPlan { key: string; fullName: string; phone?: string }
interface ReminderPlan { title: string; description: string; day: number; time: string; type: string; contact?: string }
interface NotePlan { contact?: string; content: string; label: string; isClientNote: boolean }
interface CommitmentPlan { contact?: string; label: string; quote: string }

export const NEW_CONTACTS: ContactPlan[] = [
  { key: "jose", fullName: "José Treviño Garza", phone: "8180000101" },
  { key: "rafa", fullName: "Rafael (Rafa) Salinas Cruz", phone: "8180000102" },
];

// Contactos que ya existen en la demo local (se buscan por nombre, no se crean).
const EXISTING_CONTACTS: Record<string, string> = {
  rosa: "Rosa Martínez Hernández",
  carlos: "Carlos Ramírez Ortega",
};

export const REMINDERS: ReminderPlan[] = [
  { title: "Revisar solicitud de Rafa", description: "Revisar el avance de la solicitud de seguro de Rafa.", day: 0, time: "10:00", type: "FOLLOW_UP", contact: "rafa" },
  { title: "Cita con José Treviño", description: "Reunión con José para revisar su propuesta.", day: 0, time: "17:00", type: "APPOINTMENT", contact: "jose" },
  { title: "Capacitación de producto Vida Mujer", description: "Capacitación interna sobre el producto Vida Mujer.", day: 0, time: "16:00", type: "OTHER" },
  { title: "Comprar regalo de cumpleaños para mamá", description: "Pasar por el regalo antes de la comida familiar.", day: 0, time: "19:00", type: "OTHER" },
];

// Notas cortas (<= 300 chars): guardado sin llamada a LLM, solo embedding.
export const NOTES: NotePlan[] = [
  {
    contact: "rosa",
    label: "Rosa gripa",
    content: "Rosa me dijo que tiene gripa y fiebre desde hace dos días, por eso no puede firmar esta semana. Quedamos de retomar la firma la próxima semana.",
    isClientNote: true,
  },
  {
    contact: "carlos",
    label: "Carlos rodilla",
    content: "Carlos se lastimó la rodilla jugando fútbol y es posible que lo operen. Revisar su cobertura de gastos médicos mayores (GMM) por si necesita cirugía.",
    isClientNote: true,
  },
  {
    contact: "rafa",
    label: "Rafa solicitud",
    content: "La solicitud de seguro de Rafa sigue pendiente: la aseguradora le pidió exámenes médicos y todavía no se los hace. Sin eso no se emite la póliza.",
    isClientNote: true,
  },
];

// Documentos generales (sin cliente). Largos (> 300 chars): la ingesta usa Gemini para el
// resumen además del embedding. Pasan por /ai/ingest-text, que gasta cuota de ingesta.
export const DOCUMENTS: NotePlan[] = [
  {
    label: "Proceso de reembolso de parto (GMM)",
    isClientNote: false,
    content: [
      "Proceso de reembolso de parto en gastos médicos mayores (GMM) - documento de prueba.",
      "Pasos para procesar un reembolso por parto:",
      "1. Confirmar que la póliza cubre maternidad y que ya pasó el periodo de espera.",
      "2. Reunir la documentación: formato de reclamación firmado, informe médico del ginecólogo, facturas originales del hospital y del médico (CFDI), identificación oficial y estado de cuenta bancario.",
      "3. Enviar el expediente completo a la aseguradora por el portal o con el ajustador.",
      "4. La aseguradora revisa el expediente y puede pedir documentos adicionales; el plazo normal de respuesta es de 15 a 30 días hábiles.",
      "5. Si se aprueba, el reembolso se deposita en la cuenta del asegurado descontando deducible y coaseguro.",
      "Tip: si el parto fue por cesárea, adjuntar también el reporte quirúrgico.",
      `(contenido de prueba ${TAG})`,
    ].join("\n"),
  },
];

// PDFs reales (carpeta fixtures/, ignorada por git). Mismo camino que la app para PDFs de
// conocimiento: GET /ai/upload-url -> PUT al signed URL -> POST /ai/ingest (SÍNCRONO: responde
// cuando Gemini ya extrajo, resumió y embebió; puede tardar decenas de segundos por PDF).
export const PDFS = [
  { file: "fixtures/vida-mujer.pdf", fileName: "eval-seed-vida-mujer.pdf", label: "Condiciones generales Vida Mujer (Seguros Monterrey)" },
  { file: "fixtures/nuevo-plenitud.pdf", fileName: "eval-seed-nuevo-plenitud.pdf", label: "Condiciones generales Nuevo Plenitud no deducible (GMM)" },
];

export const COMMITMENTS: CommitmentPlan[] = [
  { contact: "jose", label: "Mandar cotización a José", quote: "Quedé de mandarle la cotización de gastos médicos a José" },
];

// ─── Cliente HTTP ───────────────────────────────────────────────────────────

class Api {
  token = "";
  agentId = "";
  constructor(private base: string, private anonKey: string) {}

  async login(email: string, password: string) {
    const res = await fetch(`${this.base}/auth/v1/token?grant_type=password`, {
      method: "POST",
      headers: { apikey: this.anonKey, "content-type": "application/json" },
      body: JSON.stringify({ email, password }),
    });
    if (!res.ok) throw new Error(`Login failed: HTTP ${res.status}`);
    const j = await res.json();
    this.token = j.access_token;
    this.agentId = j.user?.id;
    if (!this.token || !this.agentId) throw new Error("Login response without token/user");
  }

  private headers(extra: Record<string, string> = {}) {
    return {
      apikey: this.anonKey,
      authorization: `Bearer ${this.token}`,
      "x-timezone": "America/Monterrey",
      "accept-language": "es-MX",
      ...extra,
    };
  }

  /** Llama a la Edge Function amconnect-api; devuelve `data` del envelope. */
  /** Sube al signed URL de Storage (como supabase-js uploadToSignedUrl: PUT multipart con `file`). */
  async putSigned(uploadUrl: string, bytes: Uint8Array) {
    // El signed URL puede traer el host interno de Docker; se reapunta a EVAL_BASE_URL.
    const u = new URL(uploadUrl);
    const target = `${this.base}${u.pathname}${u.search}`;
    const form = new FormData();
    form.append("cacheControl", "3600");
    form.append("", new Blob([bytes as Uint8Array<ArrayBuffer>], { type: "application/pdf" }));
    const res = await fetch(target, { method: "PUT", headers: { apikey: this.anonKey, "x-upsert": "true" }, body: form });
    if (!res.ok) throw new Error(`storage upload HTTP ${res.status}`);
  }

  async call<T>(method: string, path: string, body?: unknown, timeoutMs = 120_000): Promise<T> {
    const res = await fetch(`${this.base}/functions/v1/amconnect-api${path}`, {
      method,
      headers: this.headers(body === undefined ? {} : { "content-type": "application/json" }),
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: AbortSignal.timeout(timeoutMs),
    });
    const j = await res.json().catch(() => ({}));
    if (!res.ok || !j.success) throw new Error(`${method} ${path} HTTP ${res.status} ${j.errorCode ?? ""}`.trim());
    return j.data as T;
  }

  async rest<T>(method: "GET" | "POST" | "PATCH", path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${this.base}/rest/v1/${path}`, {
      method,
      headers: this.headers({ "content-type": "application/json", prefer: "return=representation" }),
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`rest ${method} ${path.split("?")[0]} HTTP ${res.status}`);
    return await res.json() as T;
  }
}

const like = (v: string) => encodeURIComponent(`*${v}*`);

// ─── Limpieza (solo filas marcadas) ─────────────────────────────────────────

async function cleanup(api: Api) {
  const now = new Date().toISOString();
  const rems = await api.rest<{ id: string }[]>("GET", `reminders?select=id&is_active=eq.true&description=ilike.${like(TAG)}`);
  for (const r of rems) await api.call("DELETE", `/reminders/${r.id}`);
  console.log(`cleanup: ${rems.length} reminders`);

  // DELETE /notes/:id solo borra notas de póliza; las de conocimiento se dan de baja por PostgREST.
  const notes = await api.rest<{ id: string }[]>("PATCH", `agent_notes?is_active=eq.true&content=ilike.${like(TAG)}`, { is_active: false });
  console.log(`cleanup: ${notes.length} notes`);

  const comms = await api.rest<{ id: string }[]>(
    "PATCH",
    `client_commitments?is_active=eq.true&quote=ilike.${like(TAG)}`,
    { is_active: false, deleted_at: now },
  );
  console.log(`cleanup: ${comms.length} commitments`);

  // PDFs: la marca va en el nombre del archivo; sus notas se dan de baja por document_metadata_id.
  const docs = await api.rest<{ id: string }[]>("GET", `document_metadata?select=id&file_name=ilike.${like(TAG)}`);
  let pdfNotes = 0;
  for (const d of docs) {
    const n = await api.rest<{ id: string }[]>("PATCH", `agent_notes?is_active=eq.true&document_metadata_id=eq.${d.id}`, { is_active: false });
    pdfNotes += n.length;
  }
  console.log(`cleanup: ${pdfNotes} pdf notes (${docs.length} files)`);

  // Las notas de contacto llevan la marca en el contenido pero las de los contactos nuevos
  // se dan de baja con el contacto; los contactos se marcan en `occupation`.
  const contacts = await api.rest<{ id: string }[]>("GET", `contacts?select=id&is_active=eq.true&occupation=eq.${TAG}`);
  for (const c of contacts) await api.call("DELETE", `/contacts/${c.id}`);
  console.log(`cleanup: ${contacts.length} contacts`);
}

// ─── Siembra ────────────────────────────────────────────────────────────────

async function findContactId(api: Api, fullName: string): Promise<string> {
  const rows = await api.rest<{ id: string }[]>("GET", `contacts?select=id&is_active=eq.true&full_name=eq.${encodeURIComponent(fullName)}`);
  if (!rows.length) throw new Error(`Contact not found: ${fullName}`);
  return rows[0].id;
}

async function seed(api: Api) {
  await cleanup(api);

  const ids: Record<string, string> = {};
  for (const [k, name] of Object.entries(EXISTING_CONTACTS)) ids[k] = await findContactId(api, name);

  for (const c of NEW_CONTACTS) {
    const r = await api.call<{ id: string }>("POST", "/contacts", { fullName: c.fullName, phone: c.phone, occupation: TAG });
    ids[c.key] = r.id;
    console.log(`contact: ${c.fullName}`);
  }

  const types = await api.call<{ id: string; code: string }[]>("GET", "/catalog/reminder-types");
  const typeId = (code: string) => {
    const t = types.find((x) => x.code === code);
    if (!t) throw new Error(`Reminder type not found: ${code}`);
    return t.id;
  };

  for (const r of REMINDERS) {
    await api.call("POST", "/reminders", {
      typeId: typeId(r.type),
      title: r.title,
      description: `${r.description} [${TAG}]`,
      dueDate: monterreyIso(r.day, r.time),
      contactId: r.contact ? ids[r.contact] : undefined,
    });
    console.log(`reminder: ${r.title}`);
  }

  for (const n of NOTES) {
    await api.call("POST", "/ai/ingest-text", {
      content: `${n.content} (${TAG})`,
      sourceType: "text",
      contactId: ids[n.contact!],
      isClientNote: n.isClientNote,
    });
    console.log(`note: ${n.label}`);
  }

  for (const d of DOCUMENTS) {
    await api.call("POST", "/ai/ingest-text", { content: d.content, sourceType: "text", isClientNote: d.isClientNote });
    console.log(`document: ${d.label}`);
  }

  for (const f of PDFS) {
    const bytes = await Deno.readFile(new URL(f.file, import.meta.url));
    const up = await api.call<{ uploadUrl: string; storagePath: string; mimeType: string }>(
      "GET",
      `/ai/upload-url?fileName=${encodeURIComponent(f.fileName)}&mimeType=application/pdf`,
    );
    await api.putSigned(up.uploadUrl, bytes);
    console.log(`pdf: uploaded ${f.fileName}, ingesting (sync, may take a while)...`);
    await api.call("POST", "/ai/ingest", { storagePath: up.storagePath, fileName: f.fileName, mimeType: "application/pdf", makeGeneral: false }, 600_000);
    console.log(`pdf: ${f.label} ready`);
  }

  for (const c of COMMITMENTS) {
    await api.rest("POST", "client_commitments", {
      agent_id: api.agentId,
      contact_id: c.contact ? ids[c.contact] : null,
      label: c.label,
      quote: `${c.quote} [${TAG}]`,
    });
    console.log(`commitment: ${c.label}`);
  }
}

// ─── main ───────────────────────────────────────────────────────────────────

function printPlan() {
  console.log("[dry-run] plan (no network). Dates relative to now, America/Monterrey (-06:00):");
  for (const c of NEW_CONTACTS) console.log(`  contact   ${c.fullName}`);
  for (const r of REMINDERS) console.log(`  reminder  ${monterreyIso(r.day, r.time)}  ${r.title}${r.contact ? ` -> ${r.contact}` : " (personal)"}  [${r.type}]`);
  for (const n of NOTES) console.log(`  note      ${n.contact}: ${n.content.length} chars  ${n.label}`);
  for (const d of DOCUMENTS) console.log(`  document  ${d.content.length} chars  ${d.label} (general note, needs Gemini summary+embeddings)`);
  for (const f of PDFS) console.log(`  pdf       ${f.fileName}  ${f.label} (upload + sync /ai/ingest via Gemini)`);
  for (const c of COMMITMENTS) console.log(`  commitment ${c.label}${c.contact ? ` -> ${c.contact}` : ""}`);
  for (const n of [...NOTES, ...DOCUMENTS]) if (n.content.length > 2000) throw new Error(`${n.label} exceeds NOTE_MAX_LENGTH`);
}

function requireEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

async function main() {
  const args = Deno.args;
  for (const a of args) if (!["--dry-run", "--cleanup"].includes(a)) throw new Error(`Unknown argument: ${a}`);
  if (args.includes("--dry-run")) {
    if (args.includes("--cleanup")) console.log("[dry-run] would soft-delete every row tagged '" + TAG + "' (reminders, notes, commitments, contacts)");
    else printPlan();
    return;
  }
  const api = new Api(requireEnv("EVAL_BASE_URL").replace(/\/$/, ""), requireEnv("EVAL_ANON_KEY"));
  await api.login(requireEnv("EVAL_EMAIL"), requireEnv("EVAL_PASSWORD"));
  if (args.includes("--cleanup")) await cleanup(api);
  else await seed(api);
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    Deno.exit(1);
  });
}
