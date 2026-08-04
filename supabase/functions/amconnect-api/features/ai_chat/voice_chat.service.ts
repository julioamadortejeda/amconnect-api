import {
  EndSensitivity,
  type FunctionDeclaration,
  GoogleGenAI,
  Modality,
  StartSensitivity,
  type ToolListUnion,
} from "@google/genai";
import { GoogleGenAiProvider } from "../../providers/google_genai.provider.ts";
import { GeminiLiveProvider } from "../../providers/gemini_live.provider.ts";
import { LIVE_AUDIO_MODEL } from "../../shared/config.ts";
import { buildToolDeclarations } from "../../shared/tool_declarations.ts";
import { executeSkill } from "./skills/skill_executor.ts";
import { SkillContext } from "./skills/skill.core.ts";
import { buildLocalDateTime, calcTimezoneOffset } from "../../shared/datetime.ts";
import { AiSessionService } from "./ai_session.service.ts";
import { PromptService } from "../../modules/prompt/prompt.service.ts";
import { UsageService } from "../../modules/subscription/usage.service.ts";

const ALL_DOMAINS = ["contact", "policy", "reminder", "pending_task", "catalog", "knowledge"];

// Catalog CRUD de aseguradoras/ramos/productos (~786 tokens, 11% del payload de
// tools) es un flujo administrativo poco realista por voz — se mantiene solo
// lectura (search_carrier, search_branch, get_products, search_product) para
// no perder la capacidad de consulta. La Live API re-factura este payload
// completo en CADA turno de la sesión (billing acumulativo), así que este
// recorte aplica a toda la sesión, no solo a un turno.
const VOICE_EXCLUDED_SKILLS = [
  "create_carrier",
  "update_carrier",
  "create_branch",
  "update_branch",
  "create_product",
  "update_product",
];

function buildVoiceTools(): { function_declarations: FunctionDeclaration[] }[] {
  return [{
    function_declarations: buildToolDeclarations(ALL_DOMAINS, {
      exclude: VOICE_EXCLUDED_SKILLS,
      clean: true,
    }),
  }];
}

export interface VoiceToolCallLog {
  name: string;
  args?: Record<string, unknown>;
  response: unknown;
}

// Ordered log of a voice session for the WS proxy flow — text turns interleaved
// with function calls, mirroring what AiChatService pushes into `history`
// (model functionCall parts + function functionResponse parts) each loop.
type VoiceTurn =
  | { kind: "text"; role: "user" | "model"; text: string }
  | { kind: "function_call"; name: string; args: Record<string, unknown> }
  | { kind: "function_result"; name: string; response: unknown };

// Voice sessions have no per-message text channel from the backend, so the
// dynamic [CONTEXT] line that the text chat injects into each user message must
// be appended to the voice system instruction instead. Without the current
// date/time the model can't reason about "upcoming" reminders and answers that
// it has no way to know — mirrors AiChatService's contextLines.
function buildVoiceContext(timezone: string): string {
  const { localIso, offsetStr } = buildLocalDateTime(timezone);
  // Solo el contexto DINÁMICO (fecha/hora/offset) se inyecta en código. La regla
  // ESTÁTICA de idioma vive en el prompt `voice_chat_system` (BD/dev_prompts) —
  // RULES §4 prohíbe concatenar instrucciones de comportamiento en TypeScript.
  return `\n\n[CONTEXT] Current date/time: ${localIso} | Timezone offset: ${offsetStr}`;
}

export class VoiceChatService {
  constructor(
    private aiProvider: GoogleGenAiProvider,
    private skillContext: Omit<SkillContext, "agentId" | "sessionId" | "aiSessionService" | "timezone" | "timezoneOffset">,
    private aiSessionService: AiSessionService,
    private promptService: PromptService,
    private usageService: UsageService,
  ) {}

  async startSession(agentId: string, timezone: string, clientSocket: WebSocket, resumeSessionId?: string): Promise<void> {
    console.warn(`[VOICE] Starting session — agent=${agentId} timezone=${timezone}${resumeSessionId ? ` resume=${resumeSessionId}` : ""}`);

    // ── Late-bound state (filled after async init, referenced via closure) ──
    let geminiLive: GeminiLiveProvider | null = null;
    let sessionId = "";
    let pendingUserTranscript = "";
    let pendingModelTranscript = "";
    const turns: VoiceTurn[] = [];
    const accTokens = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    let flushed = false;

    // Function calls arrive mid-turn (after the user's transcript is complete
    // but before the model's turn_complete) — flush the pending user text into
    // `turns` first so history keeps question → function call → answer order.
    const pushPendingUserTurn = () => {
      if (pendingUserTranscript) {
        turns.push({ kind: "text", role: "user", text: pendingUserTranscript });
        pendingUserTranscript = "";
      }
    };

    const flushSession = async () => {
      if (flushed || !sessionId) return;
      flushed = true;
      pushPendingUserTurn();
      if (pendingModelTranscript) turns.push({ kind: "text", role: "model", text: pendingModelTranscript });
      console.warn(`[VOICE] Flushing session ${sessionId} — turns=${turns.length} tokens=${JSON.stringify(accTokens)}`);
      try {
        const session = await this.aiSessionService.getSessionContext(sessionId).catch(() => null);
        const existingHistory = session?.history ? (session.history as unknown[]) : [];

        // ai_chat_messages only gets user/model text rows — same as text chat,
        // which never writes function call/response rows there either.
        const messages = turns
          .filter((t): t is Extract<VoiceTurn, { kind: "text" }> => t.kind === "text")
          .map((t) => ({
            role: t.role,
            content: t.text,
            promptTokens: 0,
            completionTokens: 0,
            totalTokens: 0,
          }));
        const newHistory = turns.map((t) => {
          if (t.kind === "text") return { role: t.role, parts: [{ text: t.text }] };
          if (t.kind === "function_call") {
            return { role: "model", parts: [{ functionCall: { name: t.name, args: t.args } }] };
          }
          return { role: "function", parts: [{ functionResponse: { name: t.name, response: { result: t.response } } }] };
        });

        const historyDb = [...existingHistory, ...newHistory];
        
        let durationSeconds: number | undefined;
        if (session?.createdAt) {
          durationSeconds = Math.round((Date.now() - new Date(session.createdAt).getTime()) / 1000);
        }

        await this.aiSessionService.saveChatRound(agentId, sessionId, historyDb, messages, accTokens, null, durationSeconds, true);
        console.warn(`[VOICE] Session ${sessionId} saved to DB - duration=${durationSeconds}s`);
      } catch (e) {
        console.error("[VOICE] Error saving session to DB:", e);
      }
    };

    // ── Register WebSocket handlers SYNCHRONOUSLY before any await ───────────
    // The Edge Runtime closes the socket if no handlers are registered
    // when the function returns its HTTP response. Closures reference
    // geminiLive / sessionId which are assigned after the async init below.

    // Enforce 10 minutes maximum duration limit to release server resources
    const maxDurationTimer = setTimeout(() => {
      console.warn(`[VOICE] Enforcing maximum session duration of 10 minutes for ${sessionId}`);
      geminiLive?.close();
      try {
        clientSocket.close(1000, "Maximum session duration reached");
      } catch (_) {}
    }, 10 * 60 * 1000);

    clientSocket.onmessage = (event: MessageEvent) => {
      try {
        const msg = JSON.parse(event.data as string) as Record<string, unknown>;
        if (msg.type === "audio" && typeof msg.data === "string") {
          geminiLive?.sendAudio(msg.data);
        } else if (msg.type === "end") {
          geminiLive?.close();
        } else {
          console.warn(`[VOICE] << Unknown Flutter message type: ${msg.type}`);
        }
      } catch (e) {
        console.error("[VOICE] Failed to parse Flutter message:", e);
      }
    };

    clientSocket.onclose = async () => {
      clearTimeout(maxDurationTimer);
      console.warn(`[VOICE] Flutter disconnected — session ${sessionId}`);
      geminiLive?.close();
      await flushSession();
    };

    clientSocket.onerror = (err: Event) => {
      clearTimeout(maxDurationTimer);
      console.error("[VOICE] Flutter socket error:", err);
      geminiLive?.close();
    };

    // ── Async initialization ──────────────────────────────────────────────────

    try {
      if (resumeSessionId) {
        sessionId = resumeSessionId;
        console.warn(`[VOICE] Resuming session: ${sessionId}`);
      } else {
        sessionId = await this.aiSessionService.createSession(agentId, {
          triggerMessage: "[voice_session]",
          sessionType: "voice",
          modelName: LIVE_AUDIO_MODEL,
        });
        console.warn(`[VOICE] Session created: ${sessionId}`);
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to create session";
      console.error("[VOICE] createSession error:", msg);
      this.send(clientSocket, { type: "error", message: msg });
      clientSocket.close(1011, msg.slice(0, 120));
      return;
    }

    this.send(clientSocket, { type: "ready", session_id: sessionId });

    let systemInstruction: string;
    let dynamicContext: string;
    try {
      systemInstruction = await this.promptService.getPrompt("voice_chat_system");
      dynamicContext = buildVoiceContext(timezone);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load prompt";
      console.error("[VOICE] getPrompt error:", msg);
      this.send(clientSocket, { type: "error", message: msg });
      clientSocket.close(1011, msg.slice(0, 120));
      return;
    }

    const tools = buildVoiceTools();
    console.warn(`[VOICE] Skills loaded: ${tools[0].function_declarations.length} (domains: ${ALL_DOMAINS.join(", ")}, excluded: ${VOICE_EXCLUDED_SKILLS.join(", ")})`);

    const timezoneOffset = calcTimezoneOffset(timezone);
    const ctx: SkillContext = {
      agentId,
      sessionId,
      aiSessionService: this.aiSessionService,
      timezone,
      timezoneOffset,
      ...this.skillContext,
    };

    // ── Create Gemini Live provider and assign to closure variable ───────────

    geminiLive = new GeminiLiveProvider(this.aiProvider.apiKey!, this.aiProvider.model, {
      onSetupComplete: () => {
        if (dynamicContext) {
          geminiLive?.sendText(dynamicContext);
        }
        this.send(clientSocket, { type: "gemini_ready" });
      },

      onAudio: (base64Data) => {
        this.send(clientSocket, { type: "audio", data: base64Data });
      },

      onInputTranscription: (text) => {
        pendingUserTranscript += text;
        this.send(clientSocket, { type: "transcript_user", text });
      },

      onOutputTranscription: (text) => {
        pendingModelTranscript += text;
        this.send(clientSocket, { type: "transcript_model", text });
      },

      onInterrupted: () => {
        // LFPDPPP: no loguear el contenido del transcript descartado.
        console.warn("[VOICE] Barge-in — discarding partial model transcript");
        pendingModelTranscript = "";
        this.send(clientSocket, { type: "interrupted" });
      },

      onTurnComplete: async () => {
        pushPendingUserTurn();
        if (pendingModelTranscript) {
          turns.push({ kind: "text", role: "model", text: pendingModelTranscript });
          pendingModelTranscript = "";
        }

        try {
          await this.usageService.checkAndIncrementChat(agentId);
        } catch (err: unknown) {
          const msg = err instanceof Error ? err.message : "Quota exceeded";
          console.error(`[VOICE] Quota limit hit during voice session: ${msg}`);
          this.send(clientSocket, { type: "error", message: msg });
          geminiLive?.close();
          return;
        }

        this.send(clientSocket, { type: "turn_complete" });
      },

      onToolCall: async (call) => {
        // LFPDPPP: solo el NOMBRE de la skill para trazabilidad — nunca args ni
        // resultados, que contienen datos personales del asesor/cliente.
        console.warn(`[VOICE] Executing skill: "${call.name}"`);
        this.send(clientSocket, { type: "skill_call", name: call.name });

        pushPendingUserTurn();
        turns.push({ kind: "function_call", name: call.name, args: call.args });

        const execution = await executeSkill(call.name, call.args, ctx);
        turns.push({ kind: "function_result", name: call.name, response: execution.response });
        geminiLive?.sendToolResponse(call.id, call.name, execution.response);
      },

      onUsageMetadata: (usage) => {
        // Gemini manda varios usage_metadata por sesión con conteos acumulados;
        // tomar el máximo evita que un mensaje con un snapshot parcial (menor
        // al ya visto) pise el conteo real — esto es lo que causaba que
        // completion_tokens quedara en 0 en ai_sessions para voz.
        accTokens.promptTokens = Math.max(accTokens.promptTokens, usage.promptTokens);
        accTokens.completionTokens = Math.max(accTokens.completionTokens, usage.completionTokens);
        accTokens.totalTokens = Math.max(accTokens.totalTokens, usage.totalTokens);
      },

      onClose: async (_code, _reason) => {
        await flushSession();
        if (clientSocket.readyState === WebSocket.OPEN) {
          this.send(clientSocket, { type: "closed" });
          clientSocket.close(1000, "Voice session ended");
        }
      },

      onError: (message) => {
        console.error(`[VOICE] Gemini provider error: ${message}`);
        this.send(clientSocket, { type: "error", message });
      },
    });

    // Connect to Gemini Live API
    geminiLive.connect(systemInstruction, tools);
  }

  private send(socket: WebSocket, msg: Record<string, unknown>): void {
    if (socket.readyState === WebSocket.OPEN) {
      socket.send(JSON.stringify(msg));
    }
  }

  async initSession(agentId: string, timezone: string, resumeSessionId?: string, context?: any) {
    let sessionId = "";
    let historyText = "";
    if (resumeSessionId) {
      sessionId = resumeSessionId;
      console.warn(`[VOICE] REST Init - Resuming session: ${sessionId}`);
      const session = await this.aiSessionService.getSessionContext(sessionId).catch(() => null);
      if (session?.history && session.history.length > 0) {
        historyText = "\n\n[CONVERSATION HISTORY]\n";
        for (const turn of session.history as any[]) {
          const role = turn.role === "user" ? "User" : turn.role === "model" ? "Model" : "System";
          const parts = turn.parts || [];
          const textParts = parts.map((p: any) => p.text || "").join(" ").trim();
          if (textParts) {
            historyText += `${role}: ${textParts}\n`;
          }
        }
        historyText += "[END OF CONVERSATION HISTORY]\n";
      }
    } else {
      sessionId = await this.aiSessionService.createSession(agentId, {
        triggerMessage: "[voice_session]",
        sessionType: "voice",
        modelName: LIVE_AUDIO_MODEL,
      });
      console.warn(`[VOICE] REST Init - Session created: ${sessionId}`);
    }

    let contextText = "";
    if (context) {
      contextText = `\n\nActive screen context (${context.type}${context.id ? ` ID: ${context.id}` : ""}):\n${JSON.stringify(context.data, null, 2)}`;
    }

    const systemInstruction = await this.promptService.getPrompt("voice_chat_system");
    const dynamicContext = buildVoiceContext(timezone) + contextText + historyText;

    const tools = buildVoiceTools();

    return {
      sessionId,
      systemInstruction,
      dynamicContext,
      tools,
    };
  }

  async executeTool(agentId: string, sessionId: string, timezone: string, toolName: string, args: Record<string, unknown>) {
    console.warn(`[VOICE] REST Execute - executing skill: "${toolName}" for session ${sessionId}`);

    const timezoneOffset = calcTimezoneOffset(timezone);
    const ctx: SkillContext = {
      agentId,
      sessionId,
      aiSessionService: this.aiSessionService,
      timezone,
      timezoneOffset,
      ...this.skillContext,
    };

    const execution = await executeSkill(toolName, args, ctx);
    return {
      result: execution.response,
      __skillMetadata: execution.metadata,
    };
  }

  async saveRound(
    agentId: string,
    sessionId: string,
    userText: string,
    modelText: string,
    promptTokens: number,
    completionTokens: number,
    totalTokens: number,
    toolCalls: VoiceToolCallLog[] = [],
    modalityTokens?: {
      textPromptTokens?: number;
      audioPromptTokens?: number;
      textCompletionTokens?: number;
      audioCompletionTokens?: number;
    },
  ) {
    console.warn(`[VOICE] REST SaveRound - saving round for session ${sessionId} - prompt=${promptTokens} completion=${completionTokens} toolCalls=${toolCalls.length}`);

    // deno-lint-ignore no-explicit-any
    const messages: any[] = [];

    // Obtener historial previo para no sobrescribirlo
    const session = await this.aiSessionService.getSessionContext(sessionId).catch(() => null);
    const historyDb: unknown[] = session?.history ? [...(session.history as unknown[])] : [];

    const shouldPushModelMessage = !!modelText || completionTokens > 0;

    if (userText) {
      messages.push({
        role: "user",
        content: userText,
        promptTokens: shouldPushModelMessage ? 0 : promptTokens,
        completionTokens: 0,
        totalTokens: shouldPushModelMessage ? 0 : promptTokens,
        textPromptTokens: shouldPushModelMessage ? 0 : modalityTokens?.textPromptTokens,
        audioPromptTokens: shouldPushModelMessage ? 0 : modalityTokens?.audioPromptTokens,
        textCompletionTokens: 0,
        audioCompletionTokens: 0,
      });
      historyDb.push({
        role: "user",
        parts: [{ text: userText }],
      });
    }

    // Function calls happen mid-turn, between the user's question and the
    // model's spoken answer — mirrors AiChatService's history.push of
    // rawModelParts (functionCall) + functionResults (functionResponse).
    // Not added to `messages`/ai_chat_messages: text chat doesn't persist
    // function calls there either, only in ai_sessions.history.
    for (const call of toolCalls) {
      historyDb.push({
        role: "model",
        parts: [{ functionCall: { name: call.name, args: call.args ?? {} } }],
      });
      historyDb.push({
        role: "function",
        parts: [{ functionResponse: { name: call.name, response: { result: call.response } } }],
      });
    }

    if (shouldPushModelMessage) {
      messages.push({
        role: "model",
        content: modelText,
        promptTokens: promptTokens,
        completionTokens: completionTokens,
        totalTokens: promptTokens + completionTokens,
        textPromptTokens: modalityTokens?.textPromptTokens,
        audioPromptTokens: modalityTokens?.audioPromptTokens,
        textCompletionTokens: modalityTokens?.textCompletionTokens,
        audioCompletionTokens: modalityTokens?.audioCompletionTokens,
      });
      if (modelText) {
        historyDb.push({
          role: "model",
          parts: [{ text: modelText }],
        });
      }
    }

    let durationSeconds: number | undefined;
    if (session?.createdAt) {
      durationSeconds = Math.round((Date.now() - new Date(session.createdAt).getTime()) / 1000);
    }

    const accTokens = { promptTokens, completionTokens, totalTokens };
    try {
      await this.aiSessionService.saveChatRound(agentId, sessionId, historyDb, messages, accTokens, null, durationSeconds, false);
      console.warn(`[VOICE] Round saved successfully for ${sessionId} - duration=${durationSeconds}s`);
      
      // Also increment usage in DB
      await this.usageService.checkAndIncrementChat(agentId);
      
      return { success: true };
    } catch (e) {
      console.error("[VOICE] Error saving round to DB:", e);
      throw e;
    }
  }

  // Mints a short-lived Gemini Live token so the client never holds the raw
  // GEMINI_API_KEY (which is extractable by decompiling the app binary). The
  // client uses this token as the `access_token` query param on the v1alpha
  // BidiGenerateContentConstrained WebSocket instead of `?key=<API_KEY>`.
  // - newSessionExpireTime: how long the client has to OPEN the WebSocket.
  // - expireTime: how long that session may stay connected once opened.
  //
  // IMPORTANT: setting `liveConnectConstraints.config` LOCKS THE ENTIRE
  // LiveConnectConfig for the session — any config the client sends in its own
  // `setup` message (system_instruction, tools, transcription, VAD tuning...)
  // is silently ignored by the API once this is set, per @google/genai's own
  // Tokens.create() doc comment ("changing `outputAudioTranscription` in the
  // Live API connection will be ignored by the API"). So everything the voice
  // session actually needs must be baked in here — not just model + modality —
  // or the model answers with no persona, no skills and no transcript.
  async createEphemeralToken(
    systemInstruction: string,
    tools: Array<{ function_declarations: FunctionDeclaration[] }>,
  ): Promise<{ token: string; url: string; headers: Record<string, string> | null; expireTime: string; model: string }> {
    // Delegate token creation to the underlying provider (Gemini or Vertex AI)
    return await this.aiProvider.createEphemeralToken(LIVE_AUDIO_MODEL, systemInstruction, tools);
  }
}
