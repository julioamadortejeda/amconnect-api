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

  generateStructuredData<T>(
    prompt: string,
    schema: z.ZodType<T>,
    inlineData?: AiInlineData,
  ): Promise<{ data: T; usage?: TokenUsage }>;

  classifyMessage(
    message: string,
    availableDomains: string[],
  ): Promise<{ domains: string[]; usage?: TokenUsage }>;
}
