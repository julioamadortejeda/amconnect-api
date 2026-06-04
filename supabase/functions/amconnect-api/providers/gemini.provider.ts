import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  AiFunctionCall,
  AiGenerationResult,
  AiInlineData,
  AiMessage,
  AiRole,
  IAiProvider,
  TokenUsage,
} from "../core/ai_provider.interface.ts";
import { AiError } from "../shared/errors.ts";

export class GeminiProvider implements IAiProvider {
  private ai: GoogleGenAI;
  model: string;
  private embeddingModel: string;

  constructor(
    apiKey: string,
    model = "gemini-2.0-flash",
    embeddingModel = "text-embedding-004",
  ) {
    this.ai = new GoogleGenAI({ apiKey });
    this.model = model;
    this.embeddingModel = embeddingModel;
  }

  async processUserRequest(
    history: AiMessage[],
    tools: Record<string, unknown>[],
    systemInstruction?: string,
  ): Promise<AiGenerationResult> {
    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: history as never,
      config: {
        tools: tools as never,
        systemInstruction,
      },
    });

    const candidate = response.candidates?.[0];
    if (!candidate?.content?.parts) {
      throw new AiError("El modelo no devolvió respuesta válida.");
    }

    const parts = candidate.content.parts;
    const text = parts.find((p: never) => (p as { text?: string }).text)?.text;
    const functionCalls: AiFunctionCall[] = parts
      // deno-lint-ignore no-explicit-any
      .filter((p: any) => p.functionCall)
      // deno-lint-ignore no-explicit-any
      .map((p: any) => ({ name: p.functionCall.name, args: p.functionCall.args ?? {} }));

    return {
      text,
      functionCalls: functionCalls.length > 0 ? functionCalls : undefined,
      rawModelParts: parts,
      usage: response.usageMetadata
        ? {
          promptTokens: response.usageMetadata.promptTokenCount ?? 0,
          completionTokens: response.usageMetadata.candidatesTokenCount ?? 0,
          totalTokens: response.usageMetadata.totalTokenCount ?? 0,
        }
        : undefined,
    };
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
      contents: [{ role: AiRole.USER, parts: [{ text }] }],
    });
    const values = response.embeddings?.[0]?.values;
    if (!values) throw new AiError("No se pudo generar el embedding.");
    return values;
  }

  async classifyMessage(
    message: string,
    availableDomains: string[],
  ): Promise<{ domains: string[]; usage?: TokenUsage }> {

    const prompt = `Clasifica el siguiente mensaje en uno o más de estos dominios: ${availableDomains.join(", ")}.
Responde SOLO con un JSON: { "domains": ["dominio1", "dominio2"] }

Mensaje: "${message}"`;

    const response = await this.ai.models.generateContent({
      model: this.model,
      contents: [{ role: "user", parts: [{ text: prompt }] }],
      config: { responseMimeType: "application/json" },
    });

    const parsed = JSON.parse(response.text ?? "{}");
    return {
      domains: parsed.domains ?? [],
      usage: response.usageMetadata
        ? {
          promptTokens: response.usageMetadata.promptTokenCount ?? 0,
          completionTokens: response.usageMetadata.candidatesTokenCount ?? 0,
          totalTokens: response.usageMetadata.totalTokenCount ?? 0,
        }
        : undefined,
    };
  }
}
