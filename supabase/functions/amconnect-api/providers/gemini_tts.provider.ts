import { GoogleGenAI } from "@google/genai";
import { wrapGeminiError } from "./google_genai.provider.ts";
import { pcmToWavBase64 } from "../shared/audio.ts";

export const TTS_MODEL = "gemini-3.1-flash-tts-preview";
const DEFAULT_VOICE = "Kore";

/**
 * Text-to-speech para el chat de voz "turn-based" (walkie-talkie): recibe el
 * texto final de una respuesta de chat y regresa un WAV listo para reproducir.
 * Sigue AI_BACKEND igual que el resto: en vertex las peticiones salen por el
 * interceptor de fetch (OAuth + URL con proyecto). Usa generateContent y no el
 * Interactions API porque Vertex no soporta interactions — generateContent
 * funciona en ambos backends con el mismo nombre de modelo (verificado
 * 2026-07-09: 200 + audio en Studio, Vertex global y us-central1).
 */
export class GeminiTtsProvider {
  private ai: GoogleGenAI;

  constructor(apiKey: string, useVertex = false) {
    // Con API key el proyecto viene amarrado a la key — el SDK rechaza
    // combinar project/location con apiKey (mismo patrón que embeddings).
    this.ai = useVertex
      ? new GoogleGenAI({ vertexai: true, apiKey })
      : new GoogleGenAI({ apiKey });
  }

  async synthesizeSpeech(
    text: string,
    voice: string = DEFAULT_VOICE,
  ): Promise<{ audioBase64: string; mimeType: string; usage: { promptTokens: number; completionTokens: number; totalTokens: number } }> {
    // deno-lint-ignore no-explicit-any
    let response: any;
    try {
      response = await this.ai.models.generateContent({
        model: TTS_MODEL,
        contents: [{ role: "user", parts: [{ text }] }],
        config: {
          responseModalities: ["AUDIO"],
          speechConfig: { voiceConfig: { prebuiltVoiceConfig: { voiceName: voice } } },
        },
      } as never);
    } catch (e) {
      wrapGeminiError(e, "synthesizeSpeech");
    }

    const pcmBase64 = response.candidates?.[0]?.content?.parts?.find(
      // deno-lint-ignore no-explicit-any
      (p: any) => p.inlineData?.data,
    )?.inlineData?.data;
    if (!pcmBase64) {
      wrapGeminiError(new Error("El modelo TTS no devolvió audio."), "synthesizeSpeech");
    }

    return {
      audioBase64: pcmToWavBase64(pcmBase64),
      mimeType: "audio/wav",
      usage: {
        promptTokens: response.usageMetadata?.promptTokenCount ?? 0,
        completionTokens: response.usageMetadata?.candidatesTokenCount ?? 0,
        totalTokens: response.usageMetadata?.totalTokenCount ?? 0,
      },
    };
  }
}
