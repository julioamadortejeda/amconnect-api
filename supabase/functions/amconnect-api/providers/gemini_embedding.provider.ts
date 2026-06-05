import { GoogleGenAI } from "@google/genai";
import { IEmbeddingProvider } from "../core/embedding_provider.interface.ts";
import { AiError } from "../shared/errors.ts";

export class GeminiEmbeddingProvider implements IEmbeddingProvider {
  private ai: GoogleGenAI;

  constructor(apiKey: string, private outputDimensionality = 768) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async generateEmbedding(text: string): Promise<number[]> {
    debugger;
    const response = await this.ai.models.embedContent({
      model: "gemini-embedding-2",
      contents: text,
      config: { outputDimensionality: this.outputDimensionality },
    });
    const values = response.embeddings?.[0]?.values;
    if (!values) throw new AiError("No se pudo generar el embedding.");
    return values;
  }
}
