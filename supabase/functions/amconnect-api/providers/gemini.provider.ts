import { GoogleGenAI } from "@google/genai";
import { z } from "zod";
import { zodToJsonSchema } from "zod-to-json-schema";
import {
  AiFunctionCall,
  AiGenerationResult,
  AiInlineData,
  AiMessage,
  IAiProvider,
  TokenUsage,
} from "../core/ai_provider.interface.ts";
import { AiError, AiProviderError } from "../shared/errors.ts";

function wrapGeminiError(e: unknown, context: string): never {
  // deno-lint-ignore no-explicit-any
  const err = e as any;
  const status: number | undefined = err?.status ?? err?.statusCode ?? err?.httpStatus;
  const message: string = err?.message ?? String(e);

  if (status === 429 || status === 503 || status === 500) {
    throw new AiProviderError(
      `El servicio de IA no está disponible en este momento (${status}). Intenta de nuevo en unos segundos.`,
    );
  }
  throw new AiError(`Error en ${context}: ${message}`);
}

export class GeminiProvider implements IAiProvider {
  private ai: GoogleGenAI;
  model: string;
  constructor(apiKey: string, model: string) {
    this.ai = new GoogleGenAI({ apiKey });
    this.model = model;
  }

  async processUserRequest(
    history: AiMessage[],
    tools: Record<string, unknown>[],
    systemInstruction?: string,
  ): Promise<AiGenerationResult> {
    // deno-lint-ignore no-explicit-any
    let response: any;
    try {
      response = await this.ai.models.generateContent({
        model: this.model,
        contents: history as never,
        config: { tools: tools as never, systemInstruction },
      });
    } catch (e) {
      wrapGeminiError(e, "processUserRequest");
    }

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

    // deno-lint-ignore no-explicit-any
    let response: any;
    try {
      response = await this.ai.models.generateContent({
        model: this.model,
        contents: [{ role: "user", parts }],
        config: { responseMimeType: "application/json", responseSchema: jsonSchema as never },
      });
    } catch (e) {
      wrapGeminiError(e, "generateStructuredData");
    }

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

  async classifyMessage(
    message: string,
    availableDomains: string[],
  ): Promise<{ domains: string[]; usage?: TokenUsage }> {
    const prompt = `Clasifica el siguiente mensaje de un asesor de seguros en uno o más de estos dominios:
- contact: Información sobre clientes, prospectos o contactos personales. Búsqueda de teléfonos, correos, CURP, RFC, direcciones, cumpleaños, etc.
- policy: Información sobre pólizas de seguros, números de póliza, coberturas, sumas aseguradas, beneficiarios, participantes.
- reminder: Tareas, eventos, recordatorios, citas, llamadas, fechas de seguimiento, pendientes de trabajo.
- catalog: Catálogos del sistema, como aseguradoras (carriers), ramos de seguros (branches) y productos de seguros (products). Creación de nuevas compañías o ramos.
- knowledge: Búsqueda de información general en notas libres, transcripciones de audio, WhatsApp o archivos cargados por el asesor.

Dominios disponibles para clasificar: ${availableDomains.join(", ")}

Responde SOLO con un formato JSON: { "domains": ["dominio1", "dominio2"] }

Mensaje del asesor: "${message}"`;

    // deno-lint-ignore no-explicit-any
    let response: any;
    try {
      response = await this.ai.models.generateContent({
        model: this.model,
        contents: [{ role: "user", parts: [{ text: prompt }] }],
        config: { responseMimeType: "application/json" },
      });
    } catch (e) {
      wrapGeminiError(e, "classifyMessage");
    }

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
