import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  AiGenerationResult,
  AiInlineData,
  AiMessage,
  IAiProvider,
  TokenUsage,
} from "../core/ai_provider.interface.ts";
import { AiError } from "../shared/errors.ts";

/**
 * VertexAiProvider — usa Vertex AI con Service Account.
 * Se activa solo para agentes con plan 'pro'.
 * Cumple con LFPDPPP al procesar datos dentro de infraestructura Google Cloud.
 */
export class VertexAiProvider implements IAiProvider {
  private ai: GoogleGenAI;
  model: string;
  private embeddingModel: string;

  constructor(
    projectId: string,
    location = "us-central1",
    model = "gemini-2.0-flash",
    embeddingModel = "text-embedding-004",
  ) {
    this.ai = new GoogleGenAI({
      vertexai: true,
      project: projectId,
      location,
    });
    this.model = model;
    this.embeddingModel = embeddingModel;
  }

  // Chat y function calling — se delega a GeminiProvider en el DI para plan pro.
  // VertexAiProvider se usa principalmente para procesamiento de documentos.
  async processUserRequest(
    _history: AiMessage[],
    _tools: Record<string, unknown>[],
    _systemInstruction?: string,
  ): Promise<AiGenerationResult> {
    throw new AiError("processUserRequest no está implementado en VertexAiProvider. Usa GeminiProvider para chat.");
  }

  async generateStructuredData<T>(
    prompt: string,
    schema: z.ZodType<T>,
    inlineData?: AiInlineData,
  ): Promise<{ data: T; usage?: TokenUsage }> {
    const jsonSchema = zodToJsonSchema(schema, { target: "openApi3" });

    // deno-lint-ignore no-explicit-any
    const parts: any[] = [{ text: prompt }];
    if (inlineData) {
      parts.push({ inlineData: { mimeType: inlineData.mimeType, data: inlineData.data } });
    }

    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: [{ role: "user", parts }],
      config: {
        responseMimeType: "application/json",
        responseSchema: jsonSchema as never,
      },
    });

    const text = response.text ?? "{}";
    const parsed = JSON.parse(text);

    return {
      data: schema.parse(parsed),
      usage: response.usageMetadata
        ? {
          promptTokens: response.usageMetadata.promptTokenCount ?? 0,
          completionTokens: response.usageMetadata.candidatesTokenCount ?? 0,
          totalTokens: response.usageMetadata.totalTokenCount ?? 0,
        }
        : undefined,
    };
  }

  async generateEmbedding(text: string): Promise<number[]> {
    const response = await this.ai.models.embedContent({
      model: this.embeddingModel,
      contents: text,
    });
    const values = response.embeddings?.[0]?.values;
    if (!values) throw new AiError("No se pudo generar el embedding con Vertex AI.");
    return values;
  }

  async classifyMessage(
    _message: string,
    _availableDomains: string[],
  ): Promise<{ domains: string[]; usage?: TokenUsage }> {
    throw new AiError("classifyMessage no está implementado en VertexAiProvider.");
  }
}
