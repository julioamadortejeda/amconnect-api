import { AiChatService, ChatResponse } from "./ai_chat.service.ts";
import { AiSessionService } from "./ai_session.service.ts";
import { GeminiTtsProvider, TTS_MODEL } from "../../providers/gemini_tts.provider.ts";
import { AiChatContext } from "./ai.dto.ts";

export interface ChatTtsResponse extends ChatResponse {
  audioBase64: string;
  audioMimeType: string;
}

/**
 * Chat de voz "turn-based" (walkie-talkie): mismo flujo de negocio que el chat
 * de texto (clasificación, skills, historial) vía AiChatService.processMessage
 * — la única diferencia es el paso extra de sintetizar la respuesta a audio y
 * loguear su consumo de tokens por separado.
 */
export class ChatTtsService {
  constructor(
    private aiChatService: AiChatService,
    private ttsProvider: GeminiTtsProvider,
    private aiSessionService: AiSessionService,
  ) {}

  async processMessage(
    message: string,
    agentId: string,
    sessionId?: string | null,
    timezone?: string,
    context?: AiChatContext | null,
  ): Promise<ChatTtsResponse> {
    const response = await this.aiChatService.processMessage(message, agentId, sessionId, timezone, context, "chat_tts");

    const { audioBase64, mimeType, usage } = await this.ttsProvider.synthesizeSpeech(response.text);
    await this.aiSessionService.addTtsUsage(response.sessionId, TTS_MODEL, usage);

    return { ...response, audioBase64, audioMimeType: mimeType };
  }

  async cancelSession(sessionId: string): Promise<{ cancelledTasks: number }> {
    return await this.aiChatService.cancelSession(sessionId);
  }
}
