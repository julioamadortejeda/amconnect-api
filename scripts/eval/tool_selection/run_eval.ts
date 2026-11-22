// Eval de selección de herramientas contra el backend LOCAL. No se despliega.
// Ver README.md. Cuesta tokens de Gemini: no correr sin querer.
//
//   deno run -A scripts/eval/tool_selection/run_eval.ts --mode-label all --runs 3
//   deno run scripts/eval/tool_selection/run_eval.ts --dry-run     (sin red)
import { detectReplyLanguage } from "../../../supabase/functions/amconnect-api/features/ai_chat/reply_language.ts";
import { type Question, type ResultsFile, type RunResult, summaryMarkdown, validateQuestions } from "./lib.ts";

const HERE = new URL(".", import.meta.url).pathname;

function parseArgs(argv: string[]) {
  const out = { runs: 3, label: "", dryRun: false, only: "" };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--dry-run") out.dryRun = true;
    else if (a === "--runs") out.runs = Number(argv[++i]);
    else if (a === "--mode-label") out.label = argv[++i] ?? "";
    else if (a === "--only") out.only = argv[++i] ?? "";
    else throw new Error(`Unknown argument: ${a}`);
  }
  if (!Number.isInteger(out.runs) || out.runs < 1) throw new Error("--runs must be a positive integer");
  return out;
}

function requireEnv(name: string): string {
  const v = Deno.env.get(name);
  if (!v) throw new Error(`Missing required env var ${name}`);
  return v;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

// ─── Cliente HTTP ───────────────────────────────────────────────────────────

class Client {
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
    return { apikey: this.anonKey, authorization: `Bearer ${this.token}`, ...extra };
  }

  /** POST /ai/chat; reintenta en 429 respetando Retry-After (cupo `ai` = 20/min). */
  async chat(message: string, sessionId: string | null): Promise<{ text: string; sessionId: string }> {
    for (let attempt = 0; attempt < 6; attempt++) {
      const res = await fetch(`${this.base}/functions/v1/amconnect-api/ai/chat`, {
        method: "POST",
        headers: this.headers({
          "content-type": "application/json",
          "x-timezone": "America/Mexico_City",
          "accept-language": "es-MX",
        }),
        body: JSON.stringify(sessionId ? { message, sessionId } : { message }),
      });
      if (res.status === 429) {
        const wait = Number(res.headers.get("retry-after") ?? "10");
        await res.body?.cancel();
        await sleep((Number.isFinite(wait) ? wait : 10) * 1000 + 500);
        continue;
      }
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.success) throw new Error(`chat HTTP ${res.status} ${j.errorCode ?? ""}`.trim());
      return { text: String(j.data.text ?? ""), sessionId: String(j.data.sessionId) };
    }
    throw new Error("chat: rate limited too many times");
  }

  /** GET a PostgREST con el JWT del asesor (RLS: solo ve lo suyo). */
  async rest<T>(path: string): Promise<T> {
    const res = await fetch(`${this.base}/rest/v1/${path}`, { headers: this.headers() });
    if (!res.ok) throw new Error(`rest ${path.split("?")[0]} HTTP ${res.status}`);
    return await res.json() as T;
  }
}

// ─── Fuentes de datos de una corrida ────────────────────────────────────────

/**
 * Herramientas realmente llamadas: la API NO las expone en la respuesta (solo
 * `text`, `usage`, `metadata`). La fuente más limpia es `ai_sessions.history`,
 * donde el servicio persiste cada turno del modelo con sus `functionCall`.
 * Se lee por PostgREST con el JWT del asesor (RLS), sin psql.
 */
async function toolsCalled(c: Client, sessionId: string): Promise<string[]> {
  const rows = await c.rest<{ history: unknown }[]>(`ai_sessions?select=history&id=eq.${sessionId}`);
  const history = Array.isArray(rows[0]?.history) ? rows[0].history as { parts?: unknown[] }[] : [];
  const names: string[] = [];
  for (const m of history) {
    for (const p of (m.parts ?? []) as { functionCall?: { name?: string } }[]) {
      if (p?.functionCall?.name) names.push(p.functionCall.name);
    }
  }
  return names;
}

async function tokens(c: Client, sessionId: string) {
  const rows = await c.rest<{ prompt_tokens: number; cached_tokens: number; completion_tokens: number }[]>(
    `tokens_usage?select=prompt_tokens,cached_tokens,completion_tokens&session_id=eq.${sessionId}`,
  );
  return {
    promptTokens: rows.reduce((a, r) => a + (r.prompt_tokens ?? 0), 0),
    cachedTokens: rows.reduce((a, r) => a + (r.cached_tokens ?? 0), 0),
    completionTokens: rows.reduce((a, r) => a + (r.completion_tokens ?? 0), 0),
  };
}

async function countRowsSince(c: Client, table: string, sinceIso: string): Promise<number> {
  const rows = await c.rest<{ id: string }[]>(`${table}?select=id&created_at=gte.${encodeURIComponent(sinceIso)}`);
  return rows.length;
}

const CLAIM_RE =
  /\b(listo|agend[ée]|agendad[oa]|cre[ée]|creado|creada|registr[ée]|registrad[oa]|guard[ée]|guardad[oa]|a[ñn]ad[ií]|agregu[ée]|done|scheduled|created|added|saved|set up|i've (set|created|added|scheduled))\b/i;
const NEGATION_RE = /\b(no pude|no puedo|no encontr|no se pudo|couldn't|could not|unable|cannot|can't|no logr)/i;

export function claimsSuccess(reply: string): boolean {
  return CLAIM_RE.test(reply) && !NEGATION_RE.test(reply);
}

// ─── Una corrida ────────────────────────────────────────────────────────────

async function runOnce(c: Client, q: Question, run: number): Promise<RunResult> {
  const base: RunResult = {
    questionId: q.id,
    category: q.category,
    run,
    sessionId: null,
    toolsCalled: [],
    missingTools: [],
    forbiddenCalled: [],
    pass: false,
    isWrite: !!q.isWrite,
    claimedSuccess: null,
    rowCreated: null,
    falseSuccess: null,
    replyLanguage: "unknown",
    languageOk: false,
    latencyMs: 0,
    promptTokens: 0,
    cachedTokens: 0,
    completionTokens: 0,
  };
  try {
    const since = new Date(Date.now() - 1000).toISOString();
    const t0 = performance.now();
    let sessionId: string | null = null;
    let lastReply = "";
    for (const msg of [q.text, ...(q.followUps ?? [])]) {
      const r = await c.chat(msg, sessionId);
      sessionId = r.sessionId;
      lastReply = r.text;
    }
    base.latencyMs = Math.round(performance.now() - t0);
    base.sessionId = sessionId;

    // La persistencia de tokens/historial es posterior a la respuesta.
    await sleep(500);
    base.toolsCalled = await toolsCalled(c, sessionId!);
    Object.assign(base, await tokens(c, sessionId!));

    base.missingTools = q.expectedTools.filter((t) => !base.toolsCalled.includes(t));
    base.forbiddenCalled = (q.forbiddenTools ?? []).filter((t) => base.toolsCalled.includes(t));
    base.pass = base.missingTools.length === 0 && base.forbiddenCalled.length === 0;

    const d = detectReplyLanguage(lastReply, "Spanish");
    base.replyLanguage = d.source === "detected" ? (d.language === "Spanish" ? "es" : "en") : "unknown";
    // "unknown" (respuesta muy corta) no se castiga.
    base.languageOk = base.replyLanguage === "unknown" || base.replyLanguage === q.lang;

    if (q.isWrite) {
      base.claimedSuccess = claimsSuccess(lastReply);
      base.rowCreated = (await countRowsSince(c, q.writeTable ?? "reminders", since)) > 0;
      base.falseSuccess = base.claimedSuccess && !base.rowCreated;
    }
  } catch (e) {
    base.error = e instanceof Error ? e.message : String(e);
  }
  return base;
}

// ─── main ───────────────────────────────────────────────────────────────────

async function main() {
  const args = parseArgs(Deno.args);
  const questions = JSON.parse(await Deno.readTextFile(`${HERE}questions.json`)) as Question[];
  const problems = validateQuestions(questions);
  if (problems.length) throw new Error(`Invalid questions.json:\n${problems.join("\n")}`);
  const selected = args.only ? questions.filter((q) => q.id === args.only) : questions;
  if (!selected.length) throw new Error(`No question matches --only ${args.only}`);

  if (args.dryRun) {
    console.log(`[dry-run] ${selected.length} questions x ${args.runs} runs = ${selected.length * args.runs} chat sessions (no network)`);
    for (const q of selected) {
      console.log(
        `  ${q.id} [${q.category}/${q.lang}] expects=${q.expectedTools.join(",") || "-"}${q.isWrite ? " WRITE" : ""}${
          q.followUps?.length ? ` followUps=${q.followUps.length}` : ""
        }`,
      );
    }
    const fake: RunResult[] = selected.map((q) => ({
      questionId: q.id, category: q.category, run: 1, sessionId: null, toolsCalled: q.expectedTools, missingTools: [],
      forbiddenCalled: [], pass: true, isWrite: !!q.isWrite, claimedSuccess: null, rowCreated: null, falseSuccess: null,
      replyLanguage: q.lang, languageOk: true, latencyMs: 1000, promptTokens: 10000, cachedTokens: 8000, completionTokens: 100,
    }));
    console.log("\n[dry-run] summary rendering check:\n");
    console.log(summaryMarkdown({ label: args.label || "dry-run", timestamp: new Date().toISOString(), runsPerQuestion: args.runs, results: fake }));
    return;
  }

  if (!args.label) throw new Error("--mode-label is required");
  const client = new Client(requireEnv("EVAL_BASE_URL").replace(/\/$/, ""), requireEnv("EVAL_ANON_KEY"));
  await client.login(requireEnv("EVAL_EMAIL"), requireEnv("EVAL_PASSWORD"));

  const results: RunResult[] = [];
  for (const q of selected) {
    for (let run = 1; run <= args.runs; run++) {
      const r = await runOnce(client, q, run);
      results.push(r);
      console.log(`${r.pass ? "PASS" : "FAIL"} ${q.id} #${run} tools=[${r.toolsCalled.join(",")}] ${r.latencyMs}ms${r.error ? ` ERROR ${r.error}` : ""}`);
    }
  }

  const timestamp = new Date().toISOString();
  const file: ResultsFile = { label: args.label, timestamp, runsPerQuestion: args.runs, results };
  const stamp = timestamp.replace(/[:.]/g, "-");
  const base = `${HERE}results/${args.label}-${stamp}`;
  await Deno.mkdir(`${HERE}results`, { recursive: true });
  await Deno.writeTextFile(`${base}.json`, JSON.stringify(file, null, 2));
  const md = summaryMarkdown(file);
  await Deno.writeTextFile(`${base}.md`, md);
  console.log("\n" + md);
  console.log(`Wrote ${base}.json`);
}

if (import.meta.main) {
  main().catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    Deno.exit(1);
  });
}
