import { Context } from "hono";
import { AppError } from "../../shared/errors.ts";
import { VoiceChatService } from "../../features/ai_chat/voice_chat.service.ts";
import { UsageService } from "../../modules/subscription/usage.service.ts";

export class VoiceChatController {
  static async connect(c: Context): Promise<Response> {
    if (c.req.header("Upgrade")?.toLowerCase() !== "websocket") {
      throw new AppError("Este endpoint requiere una conexión WebSocket.", 426);
    }

    const agentId = c.get("agent_id") as string;
    const timezone = c.req.header("x-timezone") ?? "America/Mexico_City";
    const resumeSessionId = c.req.header("sessionId") ?? undefined;

    // Quota check before upgrading — returns HTTP error if limit exceeded
    const usageService = c.get("usage_service") as UsageService;
    await usageService.checkChatQuotaOnly(agentId);

    const voiceChatService: VoiceChatService = c.get("services").voiceChatService;

    const { socket, response } = Deno.upgradeWebSocket(c.req.raw);

    // Keep the V8 isolate alive in Supabase Edge Runtime until the WebSocket closes or errors
    const socketClosedPromise = new Promise<void>((resolve) => {
      socket.addEventListener("close", (evt) => {
        console.log(`[VOICE] client socket closed: code=${evt.code} reason="${evt.reason}"`);
        resolve();
      });
      socket.addEventListener("error", (err) => {
        console.error("[VOICE] client socket error:", err);
        resolve();
      });
    });
    // @ts-ignore: EdgeRuntime is a global variable provided by Supabase Edge Runtime
    if (typeof EdgeRuntime !== "undefined") {
      console.log("[VOICE] EdgeRuntime is defined. Calling EdgeRuntime.waitUntil.");
      // @ts-ignore
      EdgeRuntime.waitUntil(socketClosedPromise);
    } else {
      console.warn("[VOICE] EdgeRuntime is NOT defined!");
    }

    // Start session asynchronously — the WebSocket upgrade response is returned immediately
    voiceChatService.startSession(agentId, timezone, socket, resumeSessionId).catch((err: unknown) => {
      const msg = err instanceof Error ? err.message : "Voice session error";
      console.error("[VOICE] Session startup error:", msg);
      try {
        socket.send(JSON.stringify({ type: "error", message: msg }));
        socket.close(1011, msg.slice(0, 120));
      } catch (_) { /* socket may already be closed */ }
    });

    return response;
  }

  static async initSession(c: Context): Promise<Response> {
    const agentId = c.get("agent_id") as string;
    const body = await c.req.json().catch(() => ({}));
    const timezone = body.timezone ?? c.req.header("x-timezone") ?? "America/Mexico_City";
    const resumeSessionId = body.sessionId ?? c.req.header("sessionId") ?? undefined;

    const usageService = c.get("usage_service") as UsageService;
    await usageService.checkChatQuotaOnly(agentId);

    const voiceChatService: VoiceChatService = c.get("services").voiceChatService;
    const config = await voiceChatService.initSession(agentId, timezone, resumeSessionId);

    return c.json(config);
  }

  static async executeTool(c: Context): Promise<Response> {
    const agentId = c.get("agent_id") as string;
    const body = await c.req.json();
    const { sessionId, timezone, toolName, args } = body;

    const voiceChatService: VoiceChatService = c.get("services").voiceChatService;
    const result = await voiceChatService.executeTool(agentId, sessionId, timezone ?? "America/Mexico_City", toolName, args);

    return c.json(result);
  }

  static async saveRound(c: Context): Promise<Response> {
    const agentId = c.get("agent_id") as string;
    const body = await c.req.json();
    const { sessionId, userText, modelText, promptTokens, completionTokens, totalTokens } = body;

    const voiceChatService: VoiceChatService = c.get("services").voiceChatService;
    const result = await voiceChatService.saveRound(
      agentId,
      sessionId,
      userText,
      modelText,
      promptTokens ?? 0,
      completionTokens ?? 0,
      totalTokens ?? 0
    );

    return c.json(result);
  }
}
