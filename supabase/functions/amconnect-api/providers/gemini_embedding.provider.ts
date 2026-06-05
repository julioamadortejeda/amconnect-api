import { GoogleGenAI } from "@google/genai";
import { BatchEmbeddingResult, EmbeddingResult, IEmbeddingProvider } from "../core/embedding_provider.interface.ts";
import { AiError } from "../shared/errors.ts";

export class GeminiEmbeddingProvider implements IEmbeddingProvider {
  private ai: GoogleGenAI;
  readonly model = "gemini-embedding-2";

  constructor(apiKey: string, private outputDimensionality = 768) {
    this.ai = new GoogleGenAI({ apiKey });
  }

  async generateEmbedding(text: string): Promise<EmbeddingResult> {
    // deno-lint-ignore no-explicit-any
    const response: any = await this.ai.models.embedContent({
      model: this.model,
      contents: text,
      config: { outputDimensionality: this.outputDimensionality },
    });
    const values = response.embeddings?.[0]?.values;
    if (!values) throw new AiError("No se pudo generar el embedding.");
    const totalTokens = response.usageMetadata?.promptTokenCount ?? Math.ceil(text.length / 4);
    return { embedding: values, totalTokens };
  }

  async generateEmbeddings(texts: string[]): Promise<BatchEmbeddingResult> {
    console.log(`[GEMINI:embed] parallel requests — count=${texts.length} totalChars=${texts.reduce((s, t) => s + t.length, 0)}`);
    const results = await Promise.all(texts.map((t) => this.generateEmbedding(t)));
    const embeddings = results.map((r) => r.embedding);
    const totalTokens = results.reduce((sum, r) => sum + r.totalTokens, 0);
    console.log(`[GEMINI:embed] done — returned=${embeddings.length} tokens=${totalTokens}`);
    return { embeddings, totalTokens };
  }
}
