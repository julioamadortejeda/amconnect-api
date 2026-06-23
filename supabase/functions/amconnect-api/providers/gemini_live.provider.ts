const LIVE_API_URL =
  "wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1beta.GenerativeService.BidiGenerateContent";

export interface LiveToolCall {
  id: string;
  name: string;
  args: Record<string, unknown>;
}

export interface GeminiLiveCallbacks {
  onSetupComplete: () => void;
  onAudio: (base64Data: string) => void;
  onInputTranscription: (text: string) => void;
  onOutputTranscription: (text: string) => void;
  onToolCall: (call: LiveToolCall) => Promise<void>;
  onInterrupted: () => void;
  onTurnComplete: () => Promise<void>;
  onUsageMetadata: (usage: { promptTokens: number; completionTokens: number; totalTokens: number }) => void;
  onClose: (code: number, reason: string) => Promise<void>;
  onError: (message: string) => void;
}

export class GeminiLiveProvider {
  private ws: WebSocket | null = null;

  constructor(
    private apiKey: string,
    private model: string,
    private callbacks: GeminiLiveCallbacks,
  ) {}

  connect(systemInstruction: string, tools: Record<string, unknown>[]): void {
    const url = `${LIVE_API_URL}?key=${this.apiKey}`;
    console.log(`[VOICE] Connecting to Gemini Live API — model: ${this.model}`);

    this.ws = new WebSocket(url);

    this.ws.onopen = () => {
      console.log("[VOICE] WebSocket opened to Gemini Live API");
      const setup = {
        setup: {
          model: `models/${this.model}`,
          generation_config: {
            response_modalities: ["AUDIO"],
          },
          realtime_input_config: {
            automatic_activity_detection: {
              // Low sensitivity avoids false triggers from ambient noise.
              // Silence threshold 800ms gives time for natural speech pauses.
              start_of_speech_sensitivity: "START_SENSITIVITY_LOW",
              end_of_speech_sensitivity: "END_SENSITIVITY_LOW",
              prefix_padding_ms: 200,
              silence_duration_ms: 800,
            },
          },
          input_audio_transcription: {},
          output_audio_transcription: {},
          system_instruction: {
            parts: [{ text: systemInstruction }],
          },
          tools,
        },
      };
      this.ws!.send(JSON.stringify(setup));
      console.log("[VOICE] >> Setup message sent to Gemini");
    };

    this.ws.onmessage = async (event: MessageEvent) => {
      let textData: string;
      if (event.data instanceof Blob) {
        textData = await event.data.text();
      } else if (typeof event.data === "string") {
        textData = event.data;
      } else if (event.data instanceof ArrayBuffer) {
        textData = new TextDecoder().decode(event.data);
      } else {
        console.error("[VOICE] Unknown WebSocket event.data type:", typeof event.data, event.data);
        return;
      }
      await this.handleServerMessage(textData);
    };

    this.ws.onclose = async (event: CloseEvent) => {
      console.log(`[VOICE] Gemini WS closed — code=${event.code} reason="${event.reason}"`);
      await this.callbacks.onClose(event.code, event.reason);
    };

    this.ws.onerror = (_event: Event) => {
      console.error("[VOICE] Gemini WS error event");
      this.callbacks.onError("WebSocket connection error with Gemini Live API");
    };
  }

  private async handleServerMessage(raw: string): Promise<void> {
    // deno-lint-ignore no-explicit-any
    let msg: Record<string, any>;
    try {
      msg = JSON.parse(raw);
    } catch (e) {
      console.error("[VOICE] Failed to parse Gemini message:", e);
      return;
    }

    const topKeys = Object.keys(msg).join(", ");
    console.log(`[VOICE] << Gemini message keys: [${topKeys}]`);

    const setupComplete = msg.setup_complete ?? msg.setupComplete;
    if (setupComplete !== undefined) {
      console.log("[VOICE] Setup complete — Gemini session ready");
      this.callbacks.onSetupComplete();
      return;
    }

    const serverContent = msg.server_content ?? msg.serverContent;
    if (serverContent) {
      if (serverContent.interrupted === true) {
        console.log("[VOICE] Barge-in detected — model interrupted");
        this.callbacks.onInterrupted();
      }

      const modelTurn = serverContent.model_turn ?? serverContent.modelTurn;
      if (modelTurn?.parts) {
        for (const part of modelTurn.parts as Record<string, unknown>[]) {
          const inlineData = part.inline_data ?? part.inlineData;
          if (inlineData?.data) {
            this.callbacks.onAudio(inlineData.data as string);
          }
          if (part.text) {
            console.log(`[VOICE] Model text part: "${String(part.text).slice(0, 120)}"`);
          }
        }
      }

      const outputTranscription = serverContent.output_transcription ?? serverContent.outputTranscription;
      if (outputTranscription?.text) {
        const text = outputTranscription.text as string;
        console.log(`[VOICE] Model transcript: "${text.slice(0, 120)}"`);
        this.callbacks.onOutputTranscription(text);
      }

      const inputTranscription = serverContent.input_transcription ?? serverContent.inputTranscription;
      if (inputTranscription?.text) {
        const text = inputTranscription.text as string;
        console.log(`[VOICE] User transcript: "${text.slice(0, 120)}"`);
        this.callbacks.onInputTranscription(text);
      }

      const turnComplete = serverContent.turn_complete ?? serverContent.turnComplete;
      if (turnComplete === true) {
        console.log("[VOICE] Turn complete");
        await this.callbacks.onTurnComplete();
      }
    }

    const toolCall = msg.tool_call ?? msg.toolCall;
    const functionCalls = toolCall?.function_calls ?? toolCall?.functionCalls;
    if (functionCalls?.length > 0) {
      // deno-lint-ignore no-explicit-any
      const calls = functionCalls as Record<string, any>[];
      console.log(`[VOICE] Tool calls: [${calls.map((c) => c.name).join(", ")}]`);
      for (const call of calls) {
        await this.callbacks.onToolCall({
          id: call.id as string,
          name: call.name as string,
          args: (call.args ?? {}) as Record<string, unknown>,
        });
      }
    }

    const usageMetadata = msg.usage_metadata ?? msg.usageMetadata;
    if (usageMetadata) {
      const promptTokenCount = usageMetadata.prompt_token_count ?? usageMetadata.promptTokenCount ?? 0;
      const candidatesTokenCount = usageMetadata.candidates_token_count ?? usageMetadata.candidatesTokenCount ?? 0;
      const totalTokenCount = usageMetadata.total_token_count ?? usageMetadata.totalTokenCount ?? 0;

      const tokens = {
        promptTokens: promptTokenCount as number,
        completionTokens: candidatesTokenCount as number,
        totalTokens: totalTokenCount as number,
      };
      console.log(`[VOICE] Usage metadata: prompt=${tokens.promptTokens} completion=${tokens.completionTokens} total=${tokens.totalTokens}`);
      this.callbacks.onUsageMetadata(tokens);
    }
  }

  sendAudio(base64Pcm: string): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    const msg = {
      realtime_input: {
        media_chunks: [{ mime_type: "audio/pcm;rate=16000", data: base64Pcm }],
      },
    };
    this.ws.send(JSON.stringify(msg));
  }

  sendToolResponse(callId: string, name: string, result: unknown): void {
    if (this.ws?.readyState !== WebSocket.OPEN) return;
    const msg = {
      tool_response: {
        function_responses: [{ id: callId, name, response: { result } }],
      },
    };
    console.log(`[VOICE] >> Tool response sent for: ${name}`);
    this.ws.send(JSON.stringify(msg));
  }

  close(): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.close(1000, "Session ended by backend");
    }
  }

  get isConnected(): boolean {
    return this.ws?.readyState === WebSocket.OPEN;
  }
}
