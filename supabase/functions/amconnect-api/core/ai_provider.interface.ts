import { z } from "zod";

export enum AiRole {
  USER = "user",
  MODEL = "model",
  SYSTEM = "system",
  FUNCTION = "function",
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
