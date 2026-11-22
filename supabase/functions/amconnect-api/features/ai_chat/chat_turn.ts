// Piezas puras de un turno del chat de texto: qué dominios de herramientas se
// encienden, el bloque [CONTEXT] que se antepone al mensaje y lo que se lee del
// historial. Sin red ni estado: se prueban solas (chat_turn_test.ts) y
// `AiChatService` solo las orquesta.
import { AiMessage, AiRole } from "../../core/ai_provider.interface.ts";
import type { AiChatContext } from "./ai.dto.ts";

/** Dominios que el clasificador puede elegir. */
export const AVAILABLE_DOMAINS = ["contact", "policy", "reminder", "commitment", "pending_task", "catalog", "knowledge"];
export const POLICY_INGESTION_DOMAINS = ["policy_ingestion"];
/** Disponibles siempre, sin importar lo que diga el clasificador (RULES §5.1). */
const ALWAYS_ACTIVE = ["contact", "pending_task", "knowledge"];

/**
 * Dominios activos del turno a partir de lo que devolvió el clasificador.
 * Cada regla está en la tabla de RULES §5.1 (la capa invisible).
 */
export function resolveChatDomains(classified: string[], context?: AiChatContext | null): string[] {
  // Clasificador vacío ⇒ todos: cuesta tokens, no la respuesta.
  const parsedDomains = classified.length > 0 ? [...classified] : [...AVAILABLE_DOMAINS];

  // La pantalla activa fuerza su dominio.
  if (context && !parsedDomains.includes(context.type)) {
    parsedDomains.push(context.type);
  }

  // Las pólizas necesitan aseguradora, ramo y producto para resolverse.
  if (parsedDomains.includes("policy") && !parsedDomains.includes("catalog")) {
    parsedDomains.push("catalog");
  }

  // "¿Qué tengo que hacer en septiembre?" es una sola pregunta para el
  // asesor, pero sus pendientes viven en DOS lados: los recordatorios que
  // él creó y los compromisos que la IA sacó de sus notas. El clasificador
  // lee eso como agenda y devuelve solo "reminder" — y la respuesta sale
  // incompleta sin que nadie se entere. Van juntos siempre.
  if (parsedDomains.includes("reminder") && !parsedDomains.includes("commitment")) {
    parsedDomains.push("commitment");
  }
  if (parsedDomains.includes("commitment") && !parsedDomains.includes("reminder")) {
    parsedDomains.push("reminder");
  }

  return [...new Set([...ALWAYS_ACTIVE, ...parsedDomains])];
}

/** El bloque [CONTEXT] que se antepone al mensaje: va hasta el primer renglón en blanco. */
const CONTEXT_PREFIX_RE = /^\[CONTEXT\][\s\S]*?\n\n/;

/** El `Reply language` del bloque [CONTEXT], que se guarda con cada turno. */
const REPLY_LANGUAGE_RE = /\| Reply language: ([^\n|]+)/;

export interface TurnContextInput {
  localIso: string;
  offsetStr: string;
  replyLanguage: string;
  pendingTasks: Array<{ id: string; taskType: string; payload: unknown }>;
  context?: AiChatContext | null;
}

/**
 * El bloque [CONTEXT] del turno. Va en el mensaje del usuario y NO en el
 * systemInstruction: lo que cambia por request rompería el implicit caching
 * del prefijo (RULES §4).
 */
export function buildContextPrefix(input: TurnContextInput): string {
  const contextLines = [
    `[CONTEXT] Current date/time: ${input.localIso} | Timezone offset: ${input.offsetStr} | Reply language: ${input.replyLanguage}`,
  ];
  if (input.pendingTasks.length > 0) {
    const tasksText = input.pendingTasks
      .map((t) => `- ID: ${t.id}, tipo: ${t.taskType}, datos: ${JSON.stringify(t.payload)}`)
      .join("\n");
    contextLines.push(`Active pending tasks requiring resolution:\n${tasksText}`);
  }
  const context = input.context;
  if (context) {
    contextLines.push(
      `Active screen context (${context.type}${context.id ? ` ID: ${context.id}` : ""}):\n${JSON.stringify(context.data, null, 2)}`,
    );
  }
  return contextLines.join("\n") + "\n\n";
}

/**
 * El idioma en que se contestó por última vez en esta conversación.
 *
 * Se lee del historial y no de una columna nueva: el bloque [CONTEXT] viaja
 * dentro del mensaje del asesor y se persiste con él, así que el dato ya está
 * ahí. Se recorre de atrás hacia adelante para quedarse con el más reciente.
 */
export function lastReplyLanguage(history: AiMessage[]): string | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    for (const part of (history[i].parts ?? []) as { text?: unknown }[]) {
      if (typeof part.text !== "string") continue;
      const match = part.text.match(REPLY_LANGUAGE_RE);
      if (match) return match[1].trim();
    }
  }
  return undefined;
}

/**
 * Junta lo que el asesor ha ESCRITO en la conversación, para las skills que
 * verifican citas (ver `SkillContext.advisorWords`).
 *
 * Descarta los turnos del modelo y los resultados de funciones —que también
 * viajan con rol USER pero no traen texto— y le quita a cada mensaje el bloque
 * [CONTEXT] que le antepone este servicio: son fechas y datos de pantalla que
 * el asesor nunca tecleó, y dejarlos ahí permitiría validar una cita contra
 * algo que él no dijo.
 */
export function collectAdvisorWords(history: AiMessage[]): string {
  return history
    .filter((m) => m.role === AiRole.USER)
    .flatMap((m) => (m.parts ?? []) as { text?: unknown }[])
    .map((p) => p.text)
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.replace(CONTEXT_PREFIX_RE, ""))
    .join("\n");
}
