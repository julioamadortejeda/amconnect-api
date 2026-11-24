// Traduce los eventos del AgentLoop (features/ai_chat/agent_events.ts) a los
// eventos SSE de `POST /ai/chat/stream` (diseño Fase 2, §4) y los numera.
//
//   status     {"phase":"thinking","sessionId":"…"}     antes de cada llamada al modelo
//   tool       {"label":"Buscando contacto","state":"started"}
//              {"label":"…","state":"finished","ok":true}
//   delta      {"text":"…"}
//   done       mismo `data` que POST /ai/chat ({text, sessionId, usage, sessionUsage, metadata, aiBackend})
//   error      {"errorCode":"AI_PROVIDER_BUSY","error":"…","errorId":"…"}
//   cancelled  {"sessionId":"…","modelCalls":1}
//
// Cada evento lleva `id` = secuencia 1, 2, 3… dentro del stream. Al cliente
// NUNCA le llega el nombre técnico de una herramienta: solo su `label`.
import type { AgentEvent } from "../../features/ai_chat/agent_events.ts";

export type ChatStreamEventName = "status" | "tool" | "delta" | "done" | "error" | "cancelled";

export interface ChatStreamMessage {
  event: ChatStreamEventName;
  data: Record<string, unknown>;
}

/** Lo que escribe en el transporte (en producción, `stream.writeSSE` de Hono). */
export type SseSink = (message: { event: string; data: string; id: string }) => Promise<void>;

/**
 * Evento del loop → evento SSE. `null` = no viaja: `done` y `cancelled` del
 * loop se reemplazan por los del turno (después de guardar), y `exhausted` es
 * interno.
 */
export function toStreamMessage(event: AgentEvent, sessionId: string | undefined): ChatStreamMessage | null {
  switch (event.type) {
    case "model_call_started":
      return { event: "status", data: { phase: "thinking", ...(sessionId ? { sessionId } : {}) } };
    case "tool_started":
      return { event: "tool", data: { label: event.label, state: "started" } };
    case "tool_finished":
      return { event: "tool", data: { label: event.label, state: "finished", ok: event.ok } };
    case "text":
      // A propósito (decisión 2026-11-23): el texto llega completo en un solo
      // `delta`. Retractar texto cuando Gemini cambia a una herramienta no vale
      // la complejidad por ~2 s.
      return { event: "delta", data: { text: event.text } };
    default:
      return null;
  }
}

export class ChatStreamWriter {
  private seq = 0;
  private sessionId: string | undefined;

  constructor(private sink: SseSink) {}

  /** El id de la sesión viaja en cada `status` (sirve para cancelar una sesión nueva). */
  setSession(sessionId: string): void {
    this.sessionId = sessionId;
  }

  readonly onAgentEvent = async (event: AgentEvent): Promise<void> => {
    const message = toStreamMessage(event, this.sessionId);
    if (message) await this.send(message);
  };

  done(data: Record<string, unknown>): Promise<void> {
    return this.send({ event: "done", data });
  }

  error(data: { errorCode: string; error: string; errorId?: string | null }): Promise<void> {
    return this.send({ event: "error", data });
  }

  cancelled(data: { sessionId: string; modelCalls: number }): Promise<void> {
    return this.send({ event: "cancelled", data });
  }

  private async send(message: ChatStreamMessage): Promise<void> {
    this.seq++;
    await this.sink({ event: message.event, data: JSON.stringify(message.data), id: String(this.seq) });
  }
}
