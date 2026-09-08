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
import { normalizeHistoryRoles } from "../shared/ai_history.ts";
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
    protected promptService: PromptService,
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
        // Último filtro antes de salir a Gemini: un solo rol inválido en el
        // historial tumba la petición completa. Va aquí y no en cada llamador
        // para que ninguna ruta nueva pueda saltárselo.
        contents: normalizeHistoryRoles(history) as never,
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

    if (!response.text) {
      // Gemini devolvió un candidate vacío (bloqueo de seguridad, corte por
      // longitud, PDF ilegible, etc.) — sin este chequeo caía a "{}" y el
      // Zod de RawExtractionSchema tronaba con "summary/content/
      // responseMessage: Required", un error que no dice nada del problema
      // real. Mismo patrón defensivo que ya usa processUserRequest arriba.
      const blockReason = response.promptFeedback?.blockReason;
      const finishReason = response.candidates?.[0]?.finishReason;
      throw new AiError(
        `El modelo no devolvió contenido.${blockReason ? ` Bloqueado: ${blockReason}.` : ""}${finishReason && finishReason !== "STOP" ? ` finishReason: ${finishReason}.` : ""}`,
      );
    }

    // Mismo riesgo que en classifyMessage: responseMimeType no garantiza JSON
    // bien formado. Aqui si es un fallo real —no hay extraccion sin datos— pero
    // el SyntaxError crudo no dice de donde vino.
    let parsed: unknown;
    try {
      parsed = JSON.parse(response.text);
    } catch {
      throw new AiError("El modelo devolvió una respuesta que no es JSON válido.");
    }

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
    // Sin rama de respaldo: el DI construye SIEMPRE el PromptService
    // (di/index.ts) y se lo pasa a los dos providers, asi que el `if` que habia
    // aqui nunca corria — y dentro cargaba una copia entera del prompt del
    // clasificador escrita en TypeScript, sin migracion y ya desfasada.
    const prompt = await this.promptService.getPrompt("message_classifier_system", {
      availableDomains: availableDomains.join(", "),
      message,
    });

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

    // El clasificador NUNCA debe tumbar la conversación.
    //
    // `responseMimeType: "application/json"` es una peticion, no una garantia:
    // el modelo puede cortar la respuesta a medias o dejar una coma colgando y
    // JSON.parse tira SyntaxError. Sin este catch, ese error subia sin tocar
    // nada hasta el controller y el asesor recibia un 500 — reproducido en
    // LOCAL el 2026-09-04, con "...tment",\n  ]\n}" como respuesta del
    // clasificador. No se ha observado en produccion; puede estar pasando sin
    // que nadie lo relacione, porque el asesor solo ve "Error interno".
    //
    // El fallback son TODOS los dominios, no ninguno. La unica funcion del
    // clasificador es RECORTAR la lista de herramientas; si falla, lo correcto
    // es no recortar. Con lista vacia el modelo se queda sin las herramientas
    // que necesitaba y contesta que no puede hacer nada, que es peor que un
    // error: parece una respuesta.
    let parsed: { domains?: string[] };
    try {
      parsed = JSON.parse(response.text ?? "{}");
    } catch {
      console.warn("[classifyMessage] JSON inválido del clasificador — se usan todos los dominios");
      parsed = { domains: availableDomains };
    }

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
