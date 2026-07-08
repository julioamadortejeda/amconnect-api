import { GoogleGenAI } from "@google/genai";
import { wrapGeminiError } from "./google_genai.provider.ts";
import { pcmToWavBase64 } from "../shared/audio.ts";

export const TTS_MODEL = "gemini-3.1-flash-tts-preview";
const DEFAULT_VOICE = "Kore";

/**
 * Text-to-speech para el chat de voz "turn-based" (walkie-talkie): recibe el
 * texto final de una respuesta de chat y regresa un WAV listo para reproducir.
 * SIEMPRE usa AI Studio con GEMINI_API_KEY, independiente de AI_BACKEND — mismo
 * criterio que la voz Live API: son features de voz que aún no están validadas
 * en Vertex AI.
 */
export class GeminiTtsProvider {
  private ai: GoogleGenAI;

  constructor(apiKey: string) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async synthesizeSpeech(
    text: string,
    voice: string = DEFAULT_VOICE,
  ): Promise<{ audioBase64: string; mimeType: string; usage: { promptTokens: number; completionTokens: number; totalTokens: number } }> {
    // deno-lint-ignore no-explicit-any
    let response: any;
    try {
      response = await this.ai.interactions.create({
        model: TTS_MODEL,
        input: text,
        response_format: { type: "audio" },
        generation_config: { speech_config: [{ voice }] },
      } as never);
    } catch (e) {
      wrapGeminiError(e, "synthesizeSpeech");
    }

    const pcmBase64 = response.output_audio?.data;
    if (!pcmBase64) {
      wrapGeminiError(new Error("El modelo TTS no devolvió audio."), "synthesizeSpeech");
    }

    return {
      audioBase64: pcmToWavBase64(pcmBase64),
      mimeType: "audio/wav",
      usage: {
        promptTokens: response.usage?.total_input_tokens ?? 0,
        completionTokens: response.usage?.total_output_tokens ?? 0,
        totalTokens: response.usage?.total_tokens ?? 0,
      },
    };
  }
}
