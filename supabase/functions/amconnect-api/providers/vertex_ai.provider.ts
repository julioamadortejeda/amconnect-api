import { GoogleGenAI } from "@google/genai";
import { GoogleGenAiProvider } from "./google_genai.provider.ts";
import { PromptService } from "../modules/prompt/prompt.service.ts";

/**
 * VertexAiProvider — usa Vertex AI autenticando con una API key de GCP
 * (creada en Credentials y restringida a la Vertex AI API). El proyecto y la
 * región vienen amarrados a la key, por lo que NO se pasan al cliente: el SDK
 * rechaza combinar project/location con apiKey ("mutually exclusive").
 * Cumple con LFPDPPP al procesar datos dentro de infraestructura Google Cloud.
 */
export class VertexAiProvider extends GoogleGenAiProvider {
  constructor(
    apiKey: string,
    model: string,
    promptService?: PromptService,
  ) {
    super(
      new GoogleGenAI({ vertexai: true, apiKey }),
      model,
      promptService,
    );
  }
}
