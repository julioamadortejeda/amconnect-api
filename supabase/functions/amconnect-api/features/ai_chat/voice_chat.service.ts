import {
  EndSensitivity,
  type FunctionDeclaration,
  GoogleGenAI,
  Modality,
  StartSensitivity,
  type ToolListUnion,
} from "@google/genai";
import { zodToJsonSchema } from "zod-to-json-schema";
import { GeminiLiveProvider } from "../../providers/gemini_live.provider.ts";
import { getSkillByName, getSkillsByDomains } from "./skills/index.ts";
import { SkillContext } from "./skills/skill.core.ts";
import { AiSessionService } from "./ai_session.service.ts";
import { PromptService } from "../../modules/prompt/prompt.service.ts";
import { UsageService } from "../../modules/subscription/usage.service.ts";

const ALL_DOMAINS = ["contact", "policy", "reminder", "pending_task", "catalog", "knowledge"];

function calcTimezoneOffset(timezone: string): string {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "longOffset" });
    const tzName = formatter.formatToParts(now).find((p) => p.type === "timeZoneName")?.value ?? "";
    if (tzName === "GMT" || tzName === "UTC") return "+00:00";
    const match = tzName.match(/GMT([+-])(\d{1,2}):?(\d{2})?/);
    if (match) return `${match[1]}${match[2].padStart(2, "0")}:${(match[3] ?? "00").padStart(2, "0")}`;
  } catch (_) { /* fallback */ }
  return "-06:00";
}

// Voice sessions have no per-message text channel from the backend, so the
// dynamic [CONTEXT] line that the text chat injects into each user message must
// be appended to the voice system instruction instead. Without the current
// date/time the model can't reason about "upcoming" reminders and answers that
// it has no way to know — mirrors AiChatService's contextLines.
function buildVoiceContext(timezone: string): string {
  const offset = calcTimezoneOffset(timezone);
  let iso: string;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone, year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false,
    }).formatToParts(new Date());
    const get = (t: string) => parts.find((x) => x.type === t)?.value ?? "00";
    iso = `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}${offset}`;
  } catch (_) {
    iso = new Date().toISOString();
  }
  return `\n\n[CONTEXT] Current date/time: ${iso} | Timezone offset: ${offset}\n\nCRITICAL VOICE MODE RULE: You must detect the language the user is speaking in and respond in that exact same language (e.g. speak in Spanish if the user speaks to you in Spanish, speak in English if the user speaks to you in English). Do not default to English when the user speaks in Spanish.`;
}

// deno-lint-ignore no-explicit-any
function cleanSchema(obj: any): any {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(cleanSchema);
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === "additionalProperties") continue;
    cleaned[key] = cleanSchema(value);
  }
  return cleaned;
}

export class VoiceChatService {
  constructor(
    private apiKey: string,
    private model: string,
    private skillContext: Omit<SkillContext, "agentId" | "sessionId" | "aiSessionService" | "timezone" | "timezoneOffset">,
    private aiSessionService: AiSessionService,
    private promptService: PromptService,
    private usageService: UsageService,
  ) {}

  async startSession(agentId: string, timezone: string, clientSocket: WebSocket, resumeSessionId?: string): Promise<void> {
    console.log(`[VOICE] Starting session — agent=${agentId} timezone=${timezone}${resumeSessionId ? ` resume=${resumeSessionId}` : ""}`);

    // ── Late-bound state (filled after async init, referenced via closure) ──
    let geminiLive: GeminiLiveProvider | null = null;
    let sessionId = "";
    let pendingUserTranscript = "";
    let pendingModelTranscript = "";
    const turns: Array<{ role: string; text: string }> = [];
    const accTokens = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };
    let flushed = false;

    const flushSession = async () => {
      if (flushed || !sessionId) return;
      flushed = true;
      if (pendingUserTranscript) turns.push({ role: "user", text: pendingUserTranscript });
      if (pendingModelTranscript) turns.push({ role: "model", text: pendingModelTranscript });
      console.log(`[VOICE] Flushing session ${sessionId} — turns=${turns.length} tokens=${JSON.stringify(accTokens)}`);
      try {
        const session = await this.aiSessionService.getSessionContext(sessionId).catch(() => null);
        const existingHistory = session?.history ? (session.history as unknown[]) : [];

        const messages = turns.map((t) => ({
          role: t.role,
          content: t.text,
          promptTokens: 0,
          completionTokens: 0,
          totalTokens: 0,
        }));
        const newHistory = turns.map((t) => ({
          role: t.role === "user" ? "user" : "model",
          parts: [{ text: t.text }],
        }));
        
        const historyDb = [...existingHistory, ...newHistory];
        
        await this.aiSessionService.saveChatRound(agentId, sessionId, historyDb, messages, accTokens);
        console.log(`[VOICE] Session ${sessionId} saved to DB`);
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
      console.log(`[VOICE] Enforcing maximum session duration of 10 minutes for ${sessionId}`);
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
          console.log(`[VOICE] Flutter requested session end for ${sessionId}`);
          geminiLive?.close();
        } else {
          console.log(`[VOICE] << Unknown Flutter message type: ${msg.type}`);
        }
      } catch (e) {
        console.error("[VOICE] Failed to parse Flutter message:", e);
      }
    };

    clientSocket.onclose = async () => {
      clearTimeout(maxDurationTimer);
      console.log(`[VOICE] Flutter disconnected — session ${sessionId}`);
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
        console.log(`[VOICE] Resuming session: ${sessionId}`);
      } else {
        sessionId = await this.aiSessionService.createSession(agentId, {
          triggerMessage: "[voice_session]",
          sessionType: "voice",
          modelName: this.model,
        });
        console.log(`[VOICE] Session created: ${sessionId}`);
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
    try {
      systemInstruction = await this.promptService.getPrompt("ai_chat_system") + buildVoiceContext(timezone);
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Failed to load prompt";
      console.error("[VOICE] getPrompt error:", msg);
      this.send(clientSocket, { type: "error", message: msg });
      clientSocket.close(1011, msg.slice(0, 120));
      return;
    }

    const activeSkills = getSkillsByDomains(ALL_DOMAINS);
    const tools = [{
      function_declarations: activeSkills.map((s) => {
        const { $schema: _, ...parameters } = zodToJsonSchema(s.declaration.schema) as Record<string, unknown>;
        return {
          name: s.declaration.name,
          description: s.declaration.description,
          parameters: cleanSchema(parameters),
        };
      }),
    }];
    console.log(`[VOICE] Skills loaded: ${activeSkills.length} (domains: ${ALL_DOMAINS.join(", ")})`);

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

    geminiLive = new GeminiLiveProvider(this.apiKey, this.model, {
      onSetupComplete: () => {
        console.log(`[VOICE] Gemini setup complete for session ${sessionId}`);
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
        console.log(`[VOICE] Barge-in — discarding partial model transcript: "${pendingModelTranscript.slice(0, 60)}"`);
        pendingModelTranscript = "";
        this.send(clientSocket, { type: "interrupted" });
      },

      onTurnComplete: async () => {
        if (pendingUserTranscript) {
          turns.push({ role: "user", text: pendingUserTranscript });
          pendingUserTranscript = "";
        }
        if (pendingModelTranscript) {
          turns.push({ role: "model", text: pendingModelTranscript });
          pendingModelTranscript = "";
        }
        console.log(`[VOICE] Turn complete — accumulated ${turns.length} turns so far`);

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
        console.log(`[VOICE] Executing skill: "${call.name}" args=${JSON.stringify(call.args).slice(0, 200)}`);
        this.send(clientSocket, { type: "skill_call", name: call.name });

        const skill = getSkillByName(call.name);
        if (!skill) {
          console.warn(`[VOICE] Unknown skill requested: ${call.name}`);
          geminiLive?.sendToolResponse(call.id, call.name, { error: `Unknown skill: ${call.name}` });
          return;
        }

        const validation = skill.declaration.schema.safeParse(call.args);
        if (!validation.success) {
          const missing = validation.error.issues
            .map((i: { path: (string | number)[]; message: string }) =>
              `${i.path.join(".") || "field"}: ${i.message}`
            )
            .join("; ");
          console.warn(`[VOICE] Skill "${call.name}" validation failed: ${missing}`);
          geminiLive?.sendToolResponse(call.id, call.name, {
            error: `Missing required data — ${missing}. Ask the user before calling again.`,
          });
          return;
        }

        try {
          const rawResult = await skill.execute(validation.data, ctx);
          if (
            rawResult &&
            typeof rawResult === "object" &&
            "__skillMetadata" in (rawResult as Record<string, unknown>)
          ) {
            const { __skillMetadata: _, ...result } = rawResult as Record<string, unknown>;
            console.log(`[VOICE] Skill "${call.name}" result (stripped meta): ${JSON.stringify(result).slice(0, 200)}`);
            geminiLive?.sendToolResponse(call.id, call.name, result);
          } else {
            console.log(`[VOICE] Skill "${call.name}" result: ${JSON.stringify(rawResult).slice(0, 200)}`);
            geminiLive?.sendToolResponse(call.id, call.name, rawResult);
          }
        } catch (e) {
          const msg = e instanceof Error ? e.message : "Error executing skill";
          console.error(`[VOICE] Skill "${call.name}" threw: ${msg}`);
          geminiLive?.sendToolResponse(call.id, call.name, { error: msg });
        }
      },

      onUsageMetadata: (usage) => {
        accTokens.promptTokens = usage.promptTokens;
        accTokens.completionTokens = usage.completionTokens;
        accTokens.totalTokens = usage.totalTokens;
        console.log(`[VOICE] Accumulated tokens: ${JSON.stringify(accTokens)}`);
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

  async initSession(agentId: string, timezone: string, resumeSessionId?: string) {
    let sessionId = "";
    if (resumeSessionId) {
      sessionId = resumeSessionId;
      console.log(`[VOICE] REST Init - Resuming session: ${sessionId}`);
    } else {
      sessionId = await this.aiSessionService.createSession(agentId, {
        triggerMessage: "[voice_session]",
        sessionType: "voice",
        modelName: this.model,
      });
      console.log(`[VOICE] REST Init - Session created: ${sessionId}`);
    }

    const systemInstruction =
      await this.promptService.getPrompt("ai_chat_system") + buildVoiceContext(timezone);

    const activeSkills = getSkillsByDomains(ALL_DOMAINS);
    const tools = [{
      function_declarations: activeSkills.map((s) => {
        const { $schema: _, ...parameters } = zodToJsonSchema(s.declaration.schema) as Record<string, unknown>;
        return {
          name: s.declaration.name,
          description: s.declaration.description,
          parameters: cleanSchema(parameters),
        };
      }),
    }];

    return {
      sessionId,
      systemInstruction,
      tools,
    };
  }

  async executeTool(agentId: string, sessionId: string, timezone: string, toolName: string, args: Record<string, unknown>) {
    console.log(`[VOICE] REST Execute - executing skill: "${toolName}" for session ${sessionId}`);

    const timezoneOffset = calcTimezoneOffset(timezone);
    const ctx: SkillContext = {
      agentId,
      sessionId,
      aiSessionService: this.aiSessionService,
      timezone,
      timezoneOffset,
      ...this.skillContext,
    };

    const skill = getSkillByName(toolName);
    if (!skill) {
      console.warn(`[VOICE] Unknown skill requested: ${toolName}`);
      return { error: `Unknown skill: ${toolName}` };
    }

    const validation = skill.declaration.schema.safeParse(args);
    if (!validation.success) {
      const missing = validation.error.issues
        .map((i: { path: (string | number)[]; message: string }) =>
          `${i.path.join(".") || "field"}: ${i.message}`
        )
        .join("; ");
      console.warn(`[VOICE] Skill "${toolName}" validation failed: ${missing}`);
      return {
        error: `Missing required data — ${missing}. Ask the user before calling again.`,
      };
    }

    try {
      const rawResult = await skill.execute(validation.data, ctx);
      if (
        rawResult &&
        typeof rawResult === "object" &&
        "__skillMetadata" in (rawResult as Record<string, unknown>)
      ) {
        const { __skillMetadata: _, ...result } = rawResult as Record<string, unknown>;
        return result;
      } else {
        return rawResult;
      }
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Error executing skill";
      console.error(`[VOICE] Skill "${toolName}" threw: ${msg}`);
      return { error: msg };
    }
  }

  async saveRound(agentId: string, sessionId: string, userText: string, modelText: string, promptTokens: number, completionTokens: number, totalTokens: number) {
    console.log(`[VOICE] REST SaveRound - saving round for session ${sessionId} - prompt=${promptTokens} completion=${completionTokens}`);

    // deno-lint-ignore no-explicit-any
    const messages: any[] = [];
    
    // Obtener historial previo para no sobrescribirlo
    const session = await this.aiSessionService.getSessionContext(sessionId).catch(() => null);
    const historyDb: unknown[] = session?.history ? [...(session.history as unknown[])] : [];

    if (userText) {
      messages.push({
        role: "user",
        content: userText,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      });
      historyDb.push({
        role: "user",
        parts: [{ text: userText }],
      });
    }

    if (modelText) {
      messages.push({
        role: "model",
        content: modelText,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: 0,
      });
      historyDb.push({
        role: "model",
        parts: [{ text: modelText }],
      });
    }

    const accTokens = { promptTokens, completionTokens, totalTokens };
    try {
      await this.aiSessionService.saveChatRound(agentId, sessionId, historyDb, messages, accTokens);
      console.log(`[VOICE] Round saved successfully for ${sessionId}`);
      
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
  ): Promise<{ token: string; expireTime: string }> {
    const ai = new GoogleGenAI({ apiKey: this.apiKey, apiVersion: "v1alpha" });
    const now = Date.now();
    const expireTime = new Date(now + 10 * 60 * 1000).toISOString();
    const newSessionExpireTime = new Date(now + 60 * 1000).toISOString();

    // SDK config uses camelCase (functionDeclarations), unlike the snake_case
    // REST shape (function_declarations) that initSession returns to Flutter
    // and that Flutter forwards as-is in the raw WebSocket `setup` message.
    const sdkTools: ToolListUnion = tools.map((t) => ({ functionDeclarations: t.function_declarations }));

    const authToken = await ai.authTokens.create({
      config: {
        uses: 1,
        expireTime,
        newSessionExpireTime,
        liveConnectConstraints: {
          model: `models/${this.model}`,
          config: {
            responseModalities: [Modality.AUDIO],
            systemInstruction: { parts: [{ text: systemInstruction }] },
            tools: sdkTools,
            inputAudioTranscription: {},
            outputAudioTranscription: {},
            realtimeInputConfig: {
              automaticActivityDetection: {
                startOfSpeechSensitivity: StartSensitivity.START_SENSITIVITY_HIGH,
                endOfSpeechSensitivity: EndSensitivity.END_SENSITIVITY_LOW,
                prefixPaddingMs: 200,
                silenceDurationMs: 500,
              },
            },
          },
        },
        httpOptions: { apiVersion: "v1alpha" },
      },
    });

    if (!authToken.name) {
      throw new Error("Gemini no devolvió un token efímero.");
    }
    return { token: authToken.name, expireTime };
  }
}
