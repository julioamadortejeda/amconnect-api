import type { FunctionDeclaration } from "@google/genai";
import { zodToJsonSchema } from "zod-to-json-schema";
import { getSkillsByDomains } from "../features/ai_chat/skills/index.ts";

// Helper compartido para construir las declaraciones de tools (function calling)
// que consumen tanto el chat de texto (AiChatService) como la voz
// (VoiceChatService). Antes cada servicio replicaba el mapeo zodToJsonSchema +
// strip de $schema; extraído aquí (función pura) para no divergir el shape que
// recibe Gemini. RULES §6: lógica repetida en 2+ lugares → shared/.

// La voz limpia `additionalProperties` del JSON Schema (la Live API rechaza ese
// campo); el chat de texto lo conserva. Recorre el árbol de forma recursiva.
// deno-lint-ignore no-explicit-any
export function cleanSchema(obj: any): any {
  if (obj === null || typeof obj !== "object") return obj;
  if (Array.isArray(obj)) return obj.map(cleanSchema);
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (key === "additionalProperties") continue;
    cleaned[key] = cleanSchema(value);
  }
  return cleaned;
}

export interface BuildToolDeclarationsOptions {
  // Skills a excluir por nombre (ej: la voz omite el CRUD de catálogos).
  exclude?: string[];
  // Aplica cleanSchema para eliminar additionalProperties (requerido por la Live API).
  clean?: boolean;
}

export function buildToolDeclarations(
  domains: string[],
  options: BuildToolDeclarationsOptions = {},
): FunctionDeclaration[] {
  const { exclude = [], clean = false } = options;
  const skills = getSkillsByDomains(domains)
    .filter((s) => !exclude.includes(s.declaration.name));
  return skills.map((s) => {
    const { $schema: _omit, ...parameters } = zodToJsonSchema(s.declaration.schema) as Record<string, unknown>;
    return {
      name: s.declaration.name,
      description: s.declaration.description,
      parameters: clean ? cleanSchema(parameters) : parameters,
    };
  }) as FunctionDeclaration[];
}
