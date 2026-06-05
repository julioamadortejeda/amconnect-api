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
    debugger;
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
    debugger;
    // embedContent acepta ContentListUnion — array de strings = batch en un solo request
    // deno-lint-ignore no-explicit-any
    const response: any = await this.ai.models.embedContent({
      model: this.model,
      contents: texts as never,
      config: { outputDimensionality: this.outputDimensionality },
    });
    // deno-lint-ignore no-explicit-any
    const embeddings: number[][] = (response.embeddings ?? []).map((e: any) => e.values as number[]);
    const totalTokens = response.usageMetadata?.promptTokenCount ??
      texts.reduce((sum, t) => sum + Math.ceil(t.length / 4), 0);
    return { embeddings, totalTokens };
  }
}
