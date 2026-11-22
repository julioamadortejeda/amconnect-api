// Tipos y agregación compartidos por run_eval.ts y compare.ts. Sin red.

export interface Question {
  id: string;
  category: string;
  lang: "es" | "en";
  text: string;
  expectedTools: string[];
  forbiddenTools?: string[];
  isWrite?: boolean;
  /** Tabla donde debe aparecer la fila nueva en preguntas de escritura (default: reminders). */
  writeTable?: string;
  followUps?: string[];
  /** Grupos de alternativas: de CADA grupo debe haberse llamado al menos una herramienta. */
  anyOfTools?: string[][];
  /** Filas nuevas esperadas en writeTable (default 1 si isWrite). */
  expectedWrites?: number;
  /** Pasa solo si NO se creó ni modificó nada (reminders/client_commitments/agent_notes). */
  mustNotWrite?: boolean;
  /**
   * Verifica una reprogramación: antes de la corrida el recordatorio sembrado cuyo título
   * contiene `titleContains` se deja en el día `fromDayOffset` a `time`; al final su
   * due_date (hora de Monterrey) debe caer en el día `toDayOffset`.
   */
  expectUpdate?: { titleContains: string; fromDayOffset: number; toDayOffset: number; time: string };
}

/** Fecha de Monterrey (UTC-6 fijo, sin horario de verano desde 2022) a `offsetDays` de hoy, YYYY-MM-DD. */
export function monterreyYmd(offsetDays = 0, now = new Date()): string {
  const base = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Monterrey" }).format(now);
  const d = new Date(`${base}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d.toISOString().slice(0, 10);
}

/** ISO 8601 con offset -06:00 para `hhmm` ("17:00") a `offsetDays` de hoy en Monterrey. */
export function monterreyIso(offsetDays: number, hhmm: string, now = new Date()): string {
  return `${monterreyYmd(offsetDays, now)}T${hhmm}:00-06:00`;
}

export interface RunResult {
  questionId: string;
  category: string;
  run: number;
  sessionId: string | null;
  toolsCalled: string[];
  missingTools: string[];
  forbiddenCalled: string[];
  pass: boolean;
  isWrite: boolean;
  claimedSuccess: boolean | null;
  rowCreated: boolean | null;
  falseSuccess: boolean | null;
  /** La respuesta fue el texto de respaldo "Me quedé sin poder resumirte…" (no cuenta como false-success). */
  loopExhausted?: boolean;
  /** Respuesta final del asistente, truncada a 500 caracteres, para revisar fallos sin consultar la BD. */
  reply?: string;
  /** Solo si la pregunta declara expectedWrites/mustNotWrite/expectUpdate: la escritura fue la correcta. */
  writeOk?: boolean | null;
  missingAnyOf?: string[][];
  replyLanguage: "es" | "en" | "unknown";
  languageOk: boolean;
  latencyMs: number;
  promptTokens: number;
  cachedTokens: number;
  completionTokens: number;
  error?: string;
}

export interface ResultsFile {
  label: string;
  timestamp: string;
  runsPerQuestion: number;
  results: RunResult[];
}

export interface Summary {
  total: number;
  passRate: number;
  byCategory: Record<string, { total: number; pass: number }>;
  avgPromptTokens: number;
  avgCompletionTokens: number;
  cachePct: number;
  avgLatencyMs: number;
  writeFalseSuccess: number;
  loopExhausted: number;
  languageOkRate: number;
  errors: number;
}

const avg = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

export function summarize(results: RunResult[]): Summary {
  const byCategory: Summary["byCategory"] = {};
  for (const r of results) {
    const c = (byCategory[r.category] ??= { total: 0, pass: 0 });
    c.total++;
    if (r.pass) c.pass++;
  }
  const prompt = results.reduce((a, r) => a + r.promptTokens, 0);
  const cached = results.reduce((a, r) => a + r.cachedTokens, 0);
  return {
    total: results.length,
    passRate: results.length ? results.filter((r) => r.pass).length / results.length : 0,
    byCategory,
    avgPromptTokens: avg(results.map((r) => r.promptTokens)),
    avgCompletionTokens: avg(results.map((r) => r.completionTokens)),
    cachePct: prompt ? cached / prompt : 0,
    avgLatencyMs: avg(results.map((r) => r.latencyMs)),
    writeFalseSuccess: results.filter((r) => r.falseSuccess === true).length,
    loopExhausted: results.filter((r) => r.loopExhausted === true).length,
    languageOkRate: results.length ? results.filter((r) => r.languageOk).length / results.length : 0,
    errors: results.filter((r) => r.error).length,
  };
}

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
const n0 = (x: number) => Math.round(x).toString();

export function summaryMarkdown(f: ResultsFile): string {
  const s = summarize(f.results);
  const lines = [
    `# Tool selection eval: ${f.label}`,
    ``,
    `${f.timestamp} - ${f.runsPerQuestion} runs/question - ${s.total} runs`,
    ``,
    `| Category | Pass | Total | Pass rate |`,
    `|---|---:|---:|---:|`,
    ...Object.entries(s.byCategory).map(([k, v]) => `| ${k} | ${v.pass} | ${v.total} | ${pct(v.pass / v.total)} |`),
    `| **all** | ${f.results.filter((r) => r.pass).length} | ${s.total} | ${pct(s.passRate)} |`,
    ``,
    `| Metric | Value |`,
    `|---|---:|`,
    `| Avg prompt tokens | ${n0(s.avgPromptTokens)} |`,
    `| Avg completion tokens | ${n0(s.avgCompletionTokens)} |`,
    `| Cache % (cached/prompt) | ${pct(s.cachePct)} |`,
    `| Avg latency ms | ${n0(s.avgLatencyMs)} |`,
    `| Write false-success | ${s.writeFalseSuccess} |`,
    `| Loop exhausted | ${s.loopExhausted} |`,
    `| Reply language ok | ${pct(s.languageOkRate)} |`,
    `| Runs with errors | ${s.errors} |`,
  ];
  return lines.join("\n") + "\n";
}

export function compareMarkdown(a: ResultsFile, b: ResultsFile): string {
  const sa = summarize(a.results);
  const sb = summarize(b.results);
  const cats = [...new Set([...Object.keys(sa.byCategory), ...Object.keys(sb.byCategory)])];
  const rate = (s: Summary, c: string) => (s.byCategory[c] ? pct(s.byCategory[c].pass / s.byCategory[c].total) : "-");
  const rows: [string, string, string][] = [
    ...cats.map((c): [string, string, string] => [`Pass rate: ${c}`, rate(sa, c), rate(sb, c)]),
    ["Pass rate: all", pct(sa.passRate), pct(sb.passRate)],
    ["Avg prompt tokens", n0(sa.avgPromptTokens), n0(sb.avgPromptTokens)],
    ["Avg completion tokens", n0(sa.avgCompletionTokens), n0(sb.avgCompletionTokens)],
    ["Cache %", pct(sa.cachePct), pct(sb.cachePct)],
    ["Avg latency ms", n0(sa.avgLatencyMs), n0(sb.avgLatencyMs)],
    ["Write false-success", String(sa.writeFalseSuccess), String(sb.writeFalseSuccess)],
    ["Loop exhausted", String(sa.loopExhausted), String(sb.loopExhausted)],
    ["Reply language ok", pct(sa.languageOkRate), pct(sb.languageOkRate)],
    ["Runs with errors", String(sa.errors), String(sb.errors)],
  ];
  return [
    `| Metric | ${a.label} | ${b.label} |`,
    `|---|---:|---:|`,
    ...rows.map(([m, x, y]) => `| ${m} | ${x} | ${y} |`),
  ].join("\n") + "\n";
}

/** Valida questions.json; devuelve la lista de problemas (vacía = ok). */
export function validateQuestions(qs: unknown): string[] {
  const errs: string[] = [];
  if (!Array.isArray(qs)) return ["questions.json must be an array"];
  const ids = new Set<string>();
  qs.forEach((q, i) => {
    const at = `question[${i}]`;
    if (typeof q?.id !== "string" || !q.id) errs.push(`${at}: id`);
    else if (ids.has(q.id)) errs.push(`${at}: duplicate id ${q.id}`);
    else ids.add(q.id);
    if (typeof q?.category !== "string") errs.push(`${at}: category`);
    if (q?.lang !== "es" && q?.lang !== "en") errs.push(`${at}: lang must be es|en`);
    if (typeof q?.text !== "string" || !q.text) errs.push(`${at}: text`);
    if (!Array.isArray(q?.expectedTools)) errs.push(`${at}: expectedTools`);
    if (q?.forbiddenTools !== undefined && !Array.isArray(q.forbiddenTools)) errs.push(`${at}: forbiddenTools`);
    if (q?.anyOfTools !== undefined && !(Array.isArray(q.anyOfTools) && q.anyOfTools.every((g: unknown) => Array.isArray(g) && g.length)))
      errs.push(`${at}: anyOfTools must be non-empty string[][]`);
    if (q?.expectedWrites !== undefined && !Number.isInteger(q.expectedWrites)) errs.push(`${at}: expectedWrites`);
    if (q?.expectUpdate !== undefined && typeof q.expectUpdate?.titleContains !== "string") errs.push(`${at}: expectUpdate`);
    if ((q?.mustNotWrite || q?.expectUpdate || q?.expectedWrites) && !q?.isWrite) errs.push(`${at}: write checks require isWrite`);
    if (q?.followUps !== undefined && !Array.isArray(q.followUps)) errs.push(`${at}: followUps`);
  });
  return errs;
}
