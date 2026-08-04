import { GoogleGenAI } from "@google/genai";
import { BatchEmbeddingResult, EmbeddingResult, IEmbeddingProvider } from "../core/embedding_provider.interface.ts";
import { AiError } from "../shared/errors.ts";
import { getGoogleCloudAccessToken } from "../shared/google_oauth.ts";
import { EMBEDDING_MODEL, requireEnv } from "../shared/config.ts";

export class GeminiEmbeddingProvider implements IEmbeddingProvider {
  private ai: GoogleGenAI;
  readonly model = EMBEDDING_MODEL;
  private outputDimensionality: number;
  private useVertex: boolean;

  constructor(
    apiKey: string,
    outputDimensionality = 768,
    useVertex = false,
  ) {
    this.useVertex = useVertex;
    // Con API key el proyecto viene amarrado a la key — el SDK rechaza
    // combinar project/location con apiKey.
    this.ai = useVertex
      ? new GoogleGenAI({ vertexai: true, apiKey })
      : new GoogleGenAI({ apiKey });
    this.outputDimensionality = outputDimensionality;
  }

  async generateEmbedding(text: string): Promise<EmbeddingResult> {
    if (this.useVertex) {
      try {
        const token = await getGoogleCloudAccessToken();
        const projectId = requireEnv("VERTEX_PROJECT_ID");
        const url = `https://aiplatform.us.rep.googleapis.com/v1/projects/${projectId}/locations/us/publishers/google/models/gemini-embedding-2:embedContent`;
        
        const res = await fetch(url, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${token}`
          },
          body: JSON.stringify({
            content: {
              parts: [{ text }]
            },
            outputDimensionality: this.outputDimensionality
          })
        });
        
        if (!res.ok) {
          const errorText = await res.text();
          throw new Error(`Vertex AI embedContent failed: ${res.statusText} - ${errorText}`);
        }
        
        const data = await res.json();
        const values = data.embedding?.values;
        if (!values) throw new AiError("No se pudo generar el embedding desde Vertex.");
        
        const totalTokens = data.usageMetadata?.promptTokenCount ?? Math.ceil(text.length / 4);
        return { embedding: values, totalTokens };
      } catch (err) {
        throw new AiError(`Error en generación de embeddings en Vertex AI: ${err instanceof Error ? err.message : String(err)}`);
      }
    }

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
    const results = await Promise.all(texts.map((t) => this.generateEmbedding(t)));
    const embeddings = results.map((r) => r.embedding);
    const totalTokens = results.reduce((sum, r) => sum + r.totalTokens, 0);
    return { embeddings, totalTokens };
  }
}
