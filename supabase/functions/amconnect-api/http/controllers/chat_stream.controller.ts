// POST /ai/chat/stream — el mismo turno que POST /ai/chat, contado por SSE
// (diseño Fase 2, §4). Contrato de eventos: http/sse/chat_stream_writer.ts.
//
// Antes de abrir el stream (status HTTP + sobre de error de siempre): body
// inválido 422, cuota 429, sesión ajena 404, turno en curso 409. Ya abierto,
// todo sale como evento: `error` (con el mismo errorCode que daría el JSON),
// `cancelled` o `done`.
//
// Cobro: igual que /ai/chat (chat_refund_policy.ts). Si el asesor se desconecta
// (o llama a /ai/sessions/:id/cancel), el turno se detiene antes de la
// siguiente llamada al modelo o herramienta, se guarda lo ocurrido y solo se
// devuelve el cobro si no hubo ninguna llamada al modelo (§7.3).
import type { Context } from "hono";
import { streamSSE, type SSEStreamingApi } from "hono/streaming";
import { localeFromHeader } from "../../shared/locale.ts";
import { resolveTimezone } from "../../shared/datetime.ts";
import { AI_BACKEND_NAME } from "../../shared/config.ts";
import { keepAlive } from "../../shared/background.ts";
import { AiChatSchema } from "../../features/ai_chat/ai.dto.ts";
import type { AiChatService, ChatTurnOutcome, ChatTurnRequest } from "../../features/ai_chat/ai_chat.service.ts";
import { isRefundableCancel, isRefundableChatError } from "../../features/ai_chat/chat_refund_policy.ts";
import type { UsageService } from "../../modules/subscription/usage.service.ts";
import { resolveErrorResponse } from "../middleware/error.middleware.ts";
import { ChatStreamWriter } from "../sse/chat_stream_writer.ts";

/** Lo que el turno en streaming necesita, ya validado y cobrado. */
interface StreamTurn {
  req: ChatTurnRequest;
  chargeId: string;
  service: AiChatService;
  usage: UsageService;
}

export class ChatStreamController {
  static async stream(c: Context) {
    const req = ChatStreamController.parseRequest(c, await c.req.json());
    const usage = c.get("usage_service") as UsageService;
    const service: AiChatService = c.get("services").aiChatService;

    const chargeId = await usage.checkAndIncrementChat(req.agentId);
    await ChatStreamController.lockOrRefund(service, usage, req, chargeId);

    // Sin buffering en proxies (nginx/Supabase): cada evento sale al escribirse.
    c.header("X-Accel-Buffering", "no");
    return streamSSE(c, (stream) => ChatStreamController.runTurn(c, stream, { req, chargeId, service, usage }));
  }

  private static parseRequest(c: Context, body: unknown): ChatTurnRequest {
    // Schema.parse: el ZodError lo formatea el globalErrorHandler (RULES §2).
    const { message, sessionId, context } = AiChatSchema.parse(body);
    return {
      message,
      agentId: c.get("agent_id"),
      sessionId,
      context,
      timezone: resolveTimezone(c.req.header("x-timezone"), c.req.header("x-timezone-offset")),
      advisorLocale: localeFromHeader(c.req.header("Accept-Language")),
    };
  }

  /** 404/409 del candado salen como status HTTP, con el cobro devuelto (como en /ai/chat). */
  private static async lockOrRefund(service: AiChatService, usage: UsageService, req: ChatTurnRequest, chargeId: string) {
    try {
      await service.acquireTurn(req.sessionId);
    } catch (err) {
      if (isRefundableChatError(err)) await usage.refundCharge(chargeId);
      throw err;
    }
  }

  private static async runTurn(c: Context, stream: SSEStreamingApi, turn: StreamTurn): Promise<void> {
    const writer = new ChatStreamWriter((m) => stream.writeSSE(m));
    const signal = ChatStreamController.disconnectSignal(c, stream);
    const work = ChatStreamController.streamOutcome(c, writer, signal, turn);
    // Si el cliente se fue, el guardado del turno cancelado debe terminar igual.
    keepAlive(work);
    await work;
  }

  /** Se dispara si el cliente cierra la conexión (request abortado o stream cancelado). */
  private static disconnectSignal(c: Context, stream: SSEStreamingApi): AbortSignal {
    const controller = new AbortController();
    const abort = () => controller.abort();
    c.req.raw.signal?.addEventListener("abort", abort, { once: true });
    stream.onAbort(abort);
    return controller.signal;
  }

  private static async streamOutcome(
    c: Context,
    writer: ChatStreamWriter,
    signal: AbortSignal,
    { req, chargeId, service, usage }: StreamTurn,
  ): Promise<void> {
    try {
      const outcome = await service.processLockedTurn(req, {
        onEvent: writer.onAgentEvent,
        signal,
        onSessionOpened: (sessionId) => writer.setSession(sessionId),
      });
      await ChatStreamController.writeOutcome(writer, outcome, usage, chargeId);
    } catch (err) {
      if (isRefundableChatError(err)) await ChatStreamController.refundQuietly(usage, chargeId);
      const { body } = await resolveErrorResponse(err instanceof Error ? err : new Error(String(err)), c);
      await writer.error({ errorCode: body.errorCode, error: body.error, errorId: body.errorId });
    }
  }

  private static async writeOutcome(writer: ChatStreamWriter, outcome: ChatTurnOutcome, usage: UsageService, chargeId: string) {
    if (outcome.status === "done") {
      await writer.done({ ...outcome.response, aiBackend: AI_BACKEND_NAME });
      return;
    }
    if (isRefundableCancel(outcome.modelCalls)) await ChatStreamController.refundQuietly(usage, chargeId);
    await writer.cancelled({ sessionId: outcome.sessionId, modelCalls: outcome.modelCalls });
  }

  /** Con el stream abierto ya no hay a quién responder un 500: se registra y se sigue. */
  private static async refundQuietly(usage: UsageService, chargeId: string): Promise<void> {
    try {
      await usage.refundCharge(chargeId);
    } catch (e) {
      console.error("[ChatStream] refund failed:", e instanceof Error ? e.message : e);
    }
  }
}
