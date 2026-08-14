import { z } from "zod";

/**
 * Los ÚNICOS roles que acepta un `Content` de Gemini. No agregar `system` ni
 * `function`: cualquier otro valor devuelve
 * `400 Please use a valid role: user, model.` y tumba la petición completa.
 *
 * Una respuesta de herramienta va como `USER` con una part `functionResponse`;
 * la llamada va como `MODEL` con una part `functionCall`.
 */
export enum AiRole {
  USER = "user",
  MODEL = "model",
}

export interface AiMessage {
  role: AiRole;
  parts: unknown[];
}

export interface AiFunctionCall {
  name: string;
  args: Record<string, unknown>;
}

export interface TokenUsage {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens?: number;
}

export interface AiGenerationResult {
  text?: string;
  functionCalls?: AiFunctionCall[];
  rawModelParts?: unknown[];
  usage?: TokenUsage;
}

export interface AiInlineData {
  mimeType: string;
  data: string; // base64
}

export interface IAiProvider {
  model: string;

  processUserRequest(
    history: AiMessage[],
    tools: Record<string, unknown>[],
    systemInstruction?: string,
    // Fuerza que el modelo responda solo texto sin declarar function calls,
    // sin quitar `tools` del request (así no se rompe el implicit caching
    // del prefix system_instruction+tools entre turnos).
    forceTextOnly?: boolean,
  ): Promise<AiGenerationResult>;

  processInteraction(
    messageOrSteps: string | Record<string, unknown>[],
    tools: Record<string, unknown>[],
    systemInstruction?: string,
    previousInteractionId?: string,
    // Historial completo en formato generateContent. El Interactions API no lo
    // necesita (usa previousInteractionId), pero Vertex no soporta interactions
    // y su implementación delega a generateContent, que sí requiere historial.
    history?: AiMessage[],
    // Ver nota en processUserRequest — mismo propósito (preservar cache).
    forceTextOnly?: boolean,
  ): Promise<AiGenerationResult & { interactionId?: string }>;


  generateStructuredData<T>(
    prompt: string,
    schema: z.ZodType<T>,
    inlineData?: AiInlineData,
  ): Promise<{ data: T; usage?: TokenUsage }>;


  classifyMessage(
    message: string,
    availableDomains: string[],
  ): Promise<{ domains: string[]; usage?: TokenUsage }>;

  createEphemeralToken(
    model: string,
    systemInstruction: string,
    tools: Record<string, unknown>[],
  ): Promise<{ token: string; url: string; headers: Record<string, string> | null; expireTime: string; model: string }>;
}
