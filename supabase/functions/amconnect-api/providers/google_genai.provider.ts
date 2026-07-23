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
import { PromptService } from "../modules/prompt/prompt.service.ts";

export function wrapGeminiError(e: unknown, context: string): never {
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

export class GoogleGenAiProvider implements IAiProvider {
  constructor(
    protected ai: GoogleGenAI,
    public model: string,
    protected promptService?: PromptService,
    public apiKey?: string,
  ) {}

  async processUserRequest(
    history: AiMessage[],
    tools: Record<string, unknown>[],
    systemInstruction?: string,
    forceTextOnly?: boolean,
  ): Promise<AiGenerationResult> {
    // deno-lint-ignore no-explicit-any
    let response: any;
    try {
      response = await this.ai.models.generateContent({
        model: this.model,
        contents: history as never,
        config: {
          tools: tools as never,
          systemInstruction,
          // Function calling de skills (crear contacto, recordatorio, etc.) no necesita
          // razonamiento profundo — MINIMAL recorta latencia por turno sin afectar la
          // calidad de la extracción de parámetros (mismo nivel que ya usa la voz).
          thinkingConfig: { thinkingLevel: "MINIMAL" },
          // Con forceTextOnly mantenemos `tools` en el request (para no romper el
          // cache implícito del prefix) y solo deshabilitamos que el modelo las use.
          ...(forceTextOnly ? { toolConfig: { functionCallingConfig: { mode: "NONE" } } } : {}),
        } as never,
      });
      console.log("[GoogleGenAI.generateContent Usage]:", JSON.stringify(response.usageMetadata || {}));
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
          cachedTokens: response.usageMetadata.cachedContentTokenCount ?? 0,
        }
        : undefined,
    };
  }

  async processInteraction(
    messageOrSteps: string | Record<string, unknown>[],
    tools: Record<string, unknown>[],
    systemInstruction?: string,
    previousInteractionId?: string,
    _history?: AiMessage[],
    forceTextOnly?: boolean,
  ): Promise<AiGenerationResult & { interactionId?: string }> {
    // deno-lint-ignore no-explicit-any
    let response: any;
    try {
      const isSteps = Array.isArray(messageOrSteps);
      // Mapear tools para el formato de Interactions API (Vertex AI / new GenAI SDK)
      // Cada tool para interactions.create debe ser un objeto plano con {"type": "function", "name": "...", "description": "...", "parameters": {...}}
      // deno-lint-ignore no-explicit-any
      const mappedTools: any[] = [];
      if (tools) {
        for (const t of tools as any[]) {
          const declarations = t?.functionDeclarations || t?.function_declarations;
          if (declarations && Array.isArray(declarations)) {
            for (const fd of declarations) {
              mappedTools.push({
                type: "function",
                name: fd.name,
                description: fd.description,
                parameters: fd.parameters,
              });
            }
          } else {
            mappedTools.push(t);
          }
        }
      }

      // deno-lint-ignore no-explicit-any
      const params: any = {
        model: this.model,
        tools: mappedTools as never,
        system_instruction: systemInstruction,
        previous_interaction_id: previousInteractionId,
        input: messageOrSteps as any,
        generation_config: {
          // Function calling de skills no necesita razonamiento profundo — minimal
          // recorta segundos de latencia por turno (mismo nivel que ya usa la voz).
          thinking_level: "minimal",
          // Con forceTextOnly mantenemos `tools` en el request (mismo prefix que los
          // turnos anteriores) y solo bloqueamos que el modelo las use — así el
          // implicit caching de Gemini sigue reconociendo el prefix system_instruction+tools
          // en vez de perder el cache hit por mandar tools:[] (ver ai_chat.service.ts).
          ...(forceTextOnly ? { tool_choice: "none" } : {}),
        },
      };
      response = await this.ai.interactions.create(params);
      console.log("[GoogleGenAI.interactions.create Usage]:", JSON.stringify(response.usage || {}));
    } catch (e) {
      wrapGeminiError(e, "processInteraction");
    }

    const steps = response.steps || [];
    const text = response.output_text || undefined;
    const functionCalls: AiFunctionCall[] = [];
    // deno-lint-ignore no-explicit-any
    const rawModelParts: any[] = [];

    for (const step of steps) {
      if (step.type === "text") {
        rawModelParts.push({ text: step.text });
      } else if (step.type === "function_call") {
        functionCalls.push({
          name: step.name,
          args: step.arguments || {},
        });
        rawModelParts.push({
          functionCall: {
            id: step.id,
            name: step.name,
            args: step.arguments || {},
          },
        });
      }
    }

    return {
      text,
      functionCalls: functionCalls.length > 0 ? functionCalls : undefined,
      rawModelParts: rawModelParts.length > 0 ? rawModelParts : undefined,
      interactionId: response.id,
      usage: response.usage
        ? {
          promptTokens: response.usage.total_input_tokens ?? 0,
          completionTokens: response.usage.total_output_tokens ?? 0,
          totalTokens: response.usage.total_tokens ?? 0,
          cachedTokens: response.usage.total_cached_tokens ?? 0,
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
          cachedTokens: response.usageMetadata.cachedContentTokenCount ?? 0,
        }
        : undefined,
    };
  }

  async classifyMessage(
    message: string,
    availableDomains: string[],
  ): Promise<{ domains: string[]; usage?: TokenUsage }> {
    let promptTemplate: string;
    if (this.promptService) {
      promptTemplate = await this.promptService.getPrompt("message_classifier_system");
    } else {
      promptTemplate = `Classify the following message from an insurance advisor in Mexico into one or more of these domains:
- contact: Information about clients, prospects, or personal contacts. Searching for phones, emails, CURP, RFC, addresses, birthdays, etc.
- policy: Information about insurance policies, policy numbers, coverages, sum insured, beneficiaries, participants.
- reminder: Tasks, events, reminders, appointments, calls, follow-up dates, pending work.
- catalog: System catalogs such as insurance carriers, branches, and products. Creation of new companies or branches.
- knowledge: Search for general information in free notes, audio transcripts, WhatsApp, or files uploaded by the advisor.

Available domains to classify: {availableDomains}

Respond ONLY with a JSON format: { "domains": ["domain1", "domain2"] }

Advisor message: "${message}"`;
    }

    const prompt = promptTemplate
      .replace("{availableDomains}", availableDomains.join(", "))
      .replace("{message}", message);

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
          cachedTokens: response.usageMetadata.cachedContentTokenCount ?? 0,
        }
        : undefined,
    };
  }

  async createEphemeralToken(
    _model: string,
    _systemInstruction: string,
    _tools: Record<string, unknown>[],
  ): Promise<{ token: string; url: string; headers: Record<string, string> | null; expireTime: string; model: string }> {
    throw new Error("createEphemeralToken no está implementado para este proveedor.");
  }
}
