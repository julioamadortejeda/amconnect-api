// Arnés del asistente (chat de texto y voz REST) para pruebas de caracterización.
//
// Objetivo: que las pruebas del asistente toquen SOLO superficies estables —
// `POST /ai/chat` (y hermanas) por HTTP, o `AiChatService.processMessage` — con
// un proveedor de IA guionado. Así sobreviven a partir AiChatService en
// AgentLoop / ToolSelector / ConversationStore y a pasar a SSE: lo único que
// cambia entre refactors es el cableado de `buildAssistantHarness`.
//
// Piezas:
//   - ScriptedAiProvider: IAiProvider que devuelve turnos de modelo guionados
//     (texto, function calls, vacío, error) y graba lo que recibió.
//   - InMemoryAiSessionRepository: IAiSessionRepository en memoria, con la
//     semántica de RLS (un asesor no ve las sesiones de otro).
//   - buildAssistantHarness: app Hono + services reales sobre esos fakes.
import type { ToolSelectionMode } from "../assistant.config.ts";
import "./test_env.ts";
import type {
  AiFunctionCall,
  AiGenerationResult,
  AiInlineData,
  AiMessage,
  IAiProvider,
  TokenUsage,
} from "../../core/ai_provider.interface.ts";
import type { z } from "zod";
import type {
  ChatMessageRow,
  CreateSessionData,
  IAiSessionRepository,
  PendingTaskRow,
  TokenUsageRow,
  UpdateSessionData,
} from "../../features/ai_chat/ai_session.repository.ts";
import { AiSessionService } from "../../features/ai_chat/ai_session.service.ts";
import { AiChatService } from "../../features/ai_chat/ai_chat.service.ts";
import { VoiceChatService } from "../../features/ai_chat/voice_chat.service.ts";
import type { SkillServices } from "../../features/ai_chat/skills/skill.core.ts";
import type { PromptService } from "../../modules/prompt/prompt.service.ts";
import { UsageService } from "../../modules/subscription/usage.service.ts";
import { FakeSupabase } from "./fake_supabase.ts";
import { FakeUsageRepository } from "./fakes.ts";
import { type FakeSkillContext, fakeSkillContext, type FakeData } from "./fake_skill_context.ts";
import { createTestApp, TEST_AGENT_ID } from "./test_app.ts";
import { apiRouter } from "../../http/routes/index.ts";
import type { Hono } from "hono";

// ─── Proveedor guionado ─────────────────────────────────────────────────────

/** Un turno del modelo. */
export type ModelStep =
  | { text: string; usage?: TokenUsage; interactionId?: string }
  | { calls: AiFunctionCall[]; text?: string; usage?: TokenUsage; interactionId?: string }
  | { empty: true; usage?: TokenUsage }
  | { error: unknown };

/** Lo que el servicio le mandó al proveedor en una llamada a processInteraction. */
export interface RecordedInteraction {
  input: string | Record<string, unknown>[];
  /** Nombres de las herramientas declaradas en ese turno. */
  toolNames: string[];
  systemInstruction?: string;
  previousInteractionId?: string;
  /** Copia del historial en el momento de la llamada. */
  history: AiMessage[];
  forceTextOnly?: boolean;
  /** Texto del último mensaje del asesor en el historial (con el bloque [CONTEXT]). */
  lastUserText: string;
}

export type StepSource = ModelStep | ((req: RecordedInteraction, index: number) => ModelStep);

export interface ClassifyStep {
  domains: string[];
  language?: string;
  usage?: TokenUsage;
}

export class ScriptedAiProvider implements IAiProvider {
  model = "test-text-model";
  readonly interactions: RecordedInteraction[] = [];
  readonly classified: Array<{ message: string; availableDomains: string[] }> = [];
  private cursor = 0;

  constructor(
    private script: StepSource[] = [],
    public classify: ClassifyStep | ((message: string) => ClassifyStep) | { error: unknown } = {
      domains: ["contact"],
      language: "Spanish",
    },
    /** Cuando el guion se acaba: repetir el último paso (modelo que nunca para) o tronar. */
    private opts: { repeatLast?: boolean } = {},
  ) {}

  /** Agrega pasos al final del guion (útil para turnos sucesivos en un mismo test). */
  push(...steps: StepSource[]): this {
    this.script.push(...steps);
    return this;
  }

  get calls(): number {
    return this.interactions.length;
  }

  /** Herramientas ofrecidas en la llamada `i` (0 = primera). */
  toolsAt(i: number): string[] {
    return this.interactions[i].toolNames;
  }

  processInteraction(
    messageOrSteps: string | Record<string, unknown>[],
    tools: Record<string, unknown>[],
    systemInstruction?: string,
    previousInteractionId?: string,
    history?: AiMessage[],
    forceTextOnly?: boolean,
  ): Promise<AiGenerationResult & { interactionId?: string }> {
    const snapshot = structuredClone(history ?? []);
    const lastUser = [...snapshot].reverse().find((m) => m.role === "user" && (m.parts as { text?: string }[]).some((p) => typeof p.text === "string"));
    const req: RecordedInteraction = {
      input: structuredClone(messageOrSteps),
      toolNames: tools.flatMap((t) =>
        ((t.functionDeclarations ?? []) as { name: string }[]).map((d) => d.name)
      ),
      systemInstruction,
      previousInteractionId,
      history: snapshot,
      forceTextOnly,
      lastUserText: ((lastUser?.parts ?? []) as { text?: string }[]).map((p) => p.text ?? "").join(""),
    };
    this.interactions.push(req);

    const idx = this.cursor++;
    let src = this.script[idx];
    if (src === undefined && this.opts.repeatLast) src = this.script[this.script.length - 1];
    if (src === undefined) {
      return Promise.reject(new Error(`ScriptedAiProvider: script exhausted at call #${idx + 1}`));
    }
    const step = typeof src === "function" ? src(req, idx) : src;

    if ("error" in step) return Promise.reject(step.error);
    if ("empty" in step) return Promise.resolve({ usage: step.usage });
    if ("calls" in step) {
      return Promise.resolve({
        text: step.text,
        functionCalls: step.calls,
        rawModelParts: step.calls.map((c, i) => ({ functionCall: { name: c.name, args: c.args, id: `fc-${idx}-${i}` } })),
        usage: step.usage,
        interactionId: step.interactionId ?? `int-${idx + 1}`,
      });
    }
    return Promise.resolve({
      text: step.text,
      usage: step.usage,
      interactionId: step.interactionId ?? `int-${idx + 1}`,
    });
  }

  classifyMessage(message: string, availableDomains: string[]) {
    this.classified.push({ message, availableDomains });
    const c = this.classify;
    if ("error" in c) return Promise.reject(c.error);
    return Promise.resolve(typeof c === "function" ? c(message) : c);
  }

  processUserRequest(): Promise<AiGenerationResult> {
    return Promise.reject(new Error("ScriptedAiProvider.processUserRequest: not scripted"));
  }
  generateStructuredData<T>(_p: string, _s: z.ZodType<T>, _i?: AiInlineData): Promise<{ data: T; usage?: TokenUsage }> {
    return Promise.reject(new Error("ScriptedAiProvider.generateStructuredData: not scripted"));
  }
  createEphemeralToken(): Promise<never> {
    return Promise.reject(new Error("ScriptedAiProvider.createEphemeralToken: not scripted"));
  }
}

/** Atajos para armar pasos. */
export const say = (text: string, usage?: TokenUsage): ModelStep => ({ text, usage });
export const callTools = (calls: AiFunctionCall[], usage?: TokenUsage): ModelStep => ({ calls, usage });
export const callTool = (name: string, args: Record<string, unknown> = {}, usage?: TokenUsage): ModelStep =>
  ({ calls: [{ name, args }], usage });
export const usage = (promptTokens: number, completionTokens: number, cachedTokens?: number): TokenUsage => ({
  promptTokens,
  completionTokens,
  totalTokens: promptTokens + completionTokens,
  ...(cachedTokens === undefined ? {} : { cachedTokens }),
});

// ─── Repositorio de sesiones en memoria ─────────────────────────────────────

interface SessionRecord {
  id: string;
  agentId: string;
  type: string;
  modelName: string | null;
  history: unknown[];
  lastInteractionId: string | null;
  status: string;
  isBillable: boolean;
  metadata: Record<string, unknown> | null;
  triggerMessage: string;
  createdAt: string;
}

interface PendingRecord extends PendingTaskRow {
  sessionId: string;
  agentId: string;
  status: "pending" | "resolved" | "cancelled";
}

export class InMemoryAiSessionRepository implements IAiSessionRepository {
  readonly sessions = new Map<string, SessionRecord>();
  readonly messages: ChatMessageRow[] = [];
  readonly tokenRows: TokenUsageRow[] = [];
  readonly pending = new Map<string, PendingRecord>();
  readonly updates: Array<{ sessionId: string; data: UpdateSessionData }> = [];
  private seq = 0;
  /** Latencia simulada de lectura/escritura de sesión: sirve para provocar carreras entre peticiones. */
  latencyMs = 0;
  private async tick() {
    if (this.latencyMs > 0) await new Promise((r) => setTimeout(r, this.latencyMs));
  }

  /** `viewerAgentId` simula el RLS: solo se ven las sesiones propias. */
  constructor(public viewerAgentId: string | null = null) {}

  /** Siembra una sesión existente (de este u otro asesor). */
  seedSession(init: Partial<SessionRecord> & { id: string; agentId: string }): SessionRecord {
    const rec: SessionRecord = {
      type: "chat",
      modelName: "test-text-model",
      history: [],
      lastInteractionId: null,
      status: "active",
      isBillable: true,
      metadata: null,
      triggerMessage: "seed",
      createdAt: new Date().toISOString(),
      ...init,
    };
    this.sessions.set(rec.id, rec);
    return rec;
  }

  private visible(sessionId: string): SessionRecord | null {
    const s = this.sessions.get(sessionId) ?? null;
    if (!s) return null;
    if (this.viewerAgentId && s.agentId !== this.viewerAgentId) return null;
    return s;
  }

  createSession(data: CreateSessionData): Promise<string> {
    const id = crypto.randomUUID();
    this.sessions.set(id, {
      id,
      agentId: data.agentId,
      type: data.type,
      modelName: data.modelName ?? null,
      history: data.history,
      lastInteractionId: null,
      status: "active",
      isBillable: true,
      metadata: null,
      triggerMessage: data.triggerMessage,
      createdAt: new Date().toISOString(),
    });
    return Promise.resolve(id);
  }
  async updateSession(sessionId: string, data: UpdateSessionData): Promise<void> {
    await this.tick();
    this.updates.push({ sessionId, data });
    const s = this.visible(sessionId);
    if (!s) return;
    if (data.status !== undefined) s.status = data.status;
    if (data.isBillable !== undefined) s.isBillable = data.isBillable;
    if (data.history !== undefined) s.history = structuredClone(data.history);
    if (data.metadata !== undefined) s.metadata = data.metadata;
    if (data.lastInteractionId !== undefined) s.lastInteractionId = data.lastInteractionId;
  }
  deleteSession(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
    return Promise.resolve();
  }
  /** Suma de tokens_usage de la sesión (lo que en la BD hace el agregado). */
  getSessionTokens(sessionId: string) {
    const rows = this.tokenRows.filter((r) => r.sessionId === sessionId);
    const sum = (f: (r: TokenUsageRow) => number) => rows.reduce((a, r) => a + f(r), 0);
    const promptTokens = sum((r) => r.promptTokens);
    const completionTokens = sum((r) => r.completionTokens);
    return Promise.resolve({
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
      cachedTokens: sum((r) => r.cachedTokens ?? 0),
    });
  }
  async getSessionContext(sessionId: string) {
    await this.tick();
    const s = this.visible(sessionId);
    if (!s) return null;
    return {
      history: structuredClone(s.history),
      type: s.type,
      modelName: s.modelName,
      last_interaction_id: s.lastInteractionId,
      createdAt: s.createdAt,
    };
  }
  getMetadata(sessionId: string) {
    return Promise.resolve(this.visible(sessionId)?.metadata ?? null);
  }
  savePendingTask(sessionId: string, agentId: string, taskType: string, payload: Record<string, unknown>) {
    const id = `pt-${++this.seq}`;
    this.pending.set(id, { id, sessionId, agentId, taskType, payload, status: "pending" });
    return Promise.resolve(id);
  }
  resolvePendingTask(pendingTaskId: string, sessionId: string) {
    const t = this.pending.get(pendingTaskId);
    if (t && t.sessionId === sessionId) t.status = "resolved";
    return Promise.resolve();
  }
  cancelPendingTasksBySession(sessionId: string) {
    let n = 0;
    for (const t of this.pending.values()) {
      if (t.sessionId === sessionId && t.status === "pending") {
        t.status = "cancelled";
        n++;
      }
    }
    return Promise.resolve(n);
  }
  getActivePendingTasks(sessionId: string) {
    return Promise.resolve(
      [...this.pending.values()]
        .filter((t) => t.sessionId === sessionId && t.status === "pending")
        .map(({ id, taskType, payload }) => ({ id, taskType, payload })),
    );
  }
  insertChatMessages(rows: ChatMessageRow[]) {
    this.messages.push(...rows);
    return Promise.resolve();
  }
  logTokenUsage(rows: TokenUsageRow | TokenUsageRow[]) {
    this.tokenRows.push(...(Array.isArray(rows) ? rows : [rows]));
    return Promise.resolve();
  }
  getSessionTokenUsageDetails() {
    const z = { promptTokens: 0, completionTokens: 0, totalTokens: 0, cachedTokens: 0, textPromptTokens: 0, audioPromptTokens: 0, textCompletionTokens: 0, audioCompletionTokens: 0 };
    return Promise.resolve({ chat: { ...z }, extraction: { ...z }, embedding: { ...z }, summary: { ...z } });
  }
  getSessionWithRates() {
    return Promise.resolve(null);
  }
}

// ─── Prompts falsos ─────────────────────────────────────────────────────────

export class FakePromptService {
  readonly requested: Array<{ code: string; vars: Record<string, string> }> = [];
  constructor(private text = "SYSTEM PROMPT (test)") {}
  getPrompt(code: string, vars: Record<string, string> = {}): Promise<string> {
    this.requested.push({ code, vars });
    return Promise.resolve(`${this.text} [${code}]`);
  }
}

// ─── Armado ─────────────────────────────────────────────────────────────────

/** El SkillServices que espera AiChatService: el fake sin lo que depende de la sesión. */
export function toSkillServices(fake: FakeSkillContext): SkillServices {
  // deno-lint-ignore no-unused-vars
  const { agentId, sessionId, aiSessionService, timezone, timezoneOffset, advisorWords, ...services } = fake.ctx;
  return services as SkillServices;
}

export interface HarnessOptions {
  script?: StepSource[];
  classify?: ConstructorParameters<typeof ScriptedAiProvider>[1];
  repeatLast?: boolean;
  agentId?: string;
  skillData?: Partial<FakeData>;
  /** Services de skill a sustituir (p. ej. ragService, recallService, un contactService que truena). */
  skillOverrides?: Record<string, unknown>;
  /** Cuota mensual: si se pone, el repo de uso responde `quota_exceeded`. */
  quotaExceeded?: boolean;
  /**
   * Modo de selección de herramientas. Por defecto "by_domain": las pruebas de
   * caracterización fijan el comportamiento con clasificador. Las de "all" lo
   * piden explícito.
   */
  toolSelectionMode?: ToolSelectionMode;
}

export interface AssistantHarness {
  app: Hono;
  agentId: string;
  provider: ScriptedAiProvider;
  sessionsRepo: InMemoryAiSessionRepository;
  sessionService: AiSessionService;
  chatService: AiChatService;
  voiceService: VoiceChatService;
  usageRepo: FakeUsageRepository;
  usageService: UsageService;
  prompts: FakePromptService;
  skills: FakeSkillContext;
  /** Notas borradas por /cancel (embeddingsService.softDeleteNoteById). */
  softDeletedNotes: string[];
}

export function buildAssistantHarness(opts: HarnessOptions = {}): AssistantHarness {
  const agentId = opts.agentId ?? TEST_AGENT_ID;
  const provider = new ScriptedAiProvider(opts.script ?? [], opts.classify, { repeatLast: opts.repeatLast });
  const sessionsRepo = new InMemoryAiSessionRepository(agentId);
  const sessionService = new AiSessionService(sessionsRepo);
  const prompts = new FakePromptService();
  const skills = fakeSkillContext(opts.skillData);
  Object.assign(skills.ctx, opts.skillOverrides ?? {});
  const usageRepo = new FakeUsageRepository();
  if (opts.quotaExceeded) {
    usageRepo.incrementResult = { data: null, error: { message: "quota_exceeded" } } as never;
  }
  const usageService = new UsageService(usageRepo);

  const chatService = new AiChatService(provider, toSkillServices(skills), sessionService, prompts as unknown as PromptService, opts.toolSelectionMode ?? "by_domain");
  const voiceService = new VoiceChatService(
    provider as never,
    toSkillServices(skills),
    sessionService,
    prompts as unknown as PromptService,
    usageService,
  );

  const softDeletedNotes: string[] = [];
  const embeddingsService = {
    softDeleteNoteById: (_agent: string, noteId: string) => {
      softDeletedNotes.push(noteId);
      return Promise.resolve();
    },
  };

  const app = createTestApp({
    supabase: new FakeSupabase().client,
    agentId,
    context: {
      services: { aiChatService: chatService, aiSessionService: sessionService, embeddingsService, voiceChatService: voiceService },
      usage_service: usageService,
    },
    routes: (r) => r.route("/", apiRouter),
  });

  return {
    app,
    agentId,
    provider,
    sessionsRepo,
    sessionService,
    chatService,
    voiceService,
    usageRepo,
    usageService,
    prompts,
    skills,
    softDeletedNotes,
  };
}

// ─── HTTP ───────────────────────────────────────────────────────────────────

export interface HttpResult {
  status: number;
  // deno-lint-ignore no-explicit-any
  json: any;
  headers: Headers;
}

/** POST /ai/chat con headers opcionales (x-timezone, Accept-Language...). */
export async function postChat(
  h: AssistantHarness,
  body: unknown,
  headers: Record<string, string> = {},
): Promise<HttpResult> {
  return await request(h, "POST", "/ai/chat", body, headers);
}

export async function request(
  h: AssistantHarness,
  method: string,
  path: string,
  body?: unknown,
  headers: Record<string, string> = {},
  rawBody?: string,
): Promise<HttpResult> {
  const res = await h.app.request(`/amconnect-api${path}`, {
    method,
    headers: { ...(body !== undefined || rawBody !== undefined ? { "content-type": "application/json" } : {}), ...headers },
    body: rawBody ?? (body === undefined ? undefined : JSON.stringify(body)),
  });
  let json: unknown = null;
  try {
    json = await res.json();
  } catch { /* sin cuerpo JSON */ }
  return { status: res.status, json, headers: res.headers };
}

/** Texto plano de todos los mensajes del historial persistido de una sesión. */
export function persistedHistory(h: AssistantHarness, sessionId: string): AiMessage[] {
  return (h.sessionsRepo.sessions.get(sessionId)?.history ?? []) as AiMessage[];
}

/** Silencia console.warn/error/log mientras corre `fn` (el servicio es muy parlanchín). */
export async function quietLogs<T>(fn: () => Promise<T>): Promise<T> {
  const { warn, error, log } = console;
  console.warn = () => {};
  console.error = () => {};
  console.log = () => {};
  try {
    return await fn();
  } finally {
    console.warn = warn;
    console.error = error;
    console.log = log;
  }
}
