import {
  GoogleGenAI,
  Modality,
  StartSensitivity,
  EndSensitivity,
  type ToolListUnion,
} from "@google/genai";
import { GoogleGenAiProvider } from "./google_genai.provider.ts";
import { PromptService } from "../modules/prompt/prompt.service.ts";

export class GeminiProvider extends GoogleGenAiProvider {
  constructor(apiKey: string, model: string, promptService?: PromptService) {
    super(new GoogleGenAI({ apiKey }), model, promptService, apiKey);
  }

  override async createEphemeralToken(
    model: string,
    systemInstruction: string,
    tools: Record<string, unknown>[],
  ): Promise<{ token: string; url: string; headers: Record<string, string> | null; expireTime: string; model: string }> {
    const now = Date.now();
    const expireTime = new Date(now + 10 * 60 * 1000).toISOString();
    const newSessionExpireTime = new Date(now + 60 * 1000).toISOString();

    // Map tools from snake_case REST shape to camelCase expected by GoogleGenAI SDK
    // deno-lint-ignore no-explicit-any
    const sdkTools: ToolListUnion = tools.map((t: any) => ({
      functionDeclarations: t.function_declarations,
    }));

    const authToken = await this.ai.authTokens.create({
      config: {
        uses: 1,
        expireTime,
        newSessionExpireTime,
        liveConnectConstraints: {
          model: `models/${model}`,
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

    const url = `wss://generativelanguage.googleapis.com/ws/google.ai.generativelanguage.v1alpha.GenerativeService.BidiGenerateContentConstrained?access_token=${authToken.name}`;
    return {
      token: authToken.name,
      url,
      headers: null,
      expireTime,
      model: `models/${model}`,
    };
  }
}
