import { AiMessage, AiRole } from "../core/ai_provider.interface.ts";

/**
 * Deja el historial con los únicos roles que acepta un `Content` de Gemini:
 * `user` y `model`. Cualquier otro devuelve
 * `400 Please use a valid role: user, model.` y tumba la petición entera.
 *
 * Hace falta porque el historial de una sesión se acumula entre canales: la
 * voz guardaba las respuestas de las skills con `role: "function"` (ver
 * `voice_chat.service.ts`, ya corregido), así que basta una conversación por
 * voz con un tool call para que esa sesión quede envenenada y el chat de
 * texto falle en cuanto la continúe. Esas filas ya existen en producción, y
 * normalizar al vuelo es lo único que las revive.
 *
 * Una respuesta de función viaja como `user` — es lo mismo que ya hace el
 * chat de texto al reinyectar sus `functionResults`.
 *
 * OJO: que `AiRole` ya solo tenga `user`/`model` NO vuelve redundante esta
 * función. El historial se lee de `ai_sessions.history` (jsonb) con un `as
 * AiMessage[]`, así que en tiempo de ejecución todavía llegan los `"function"`
 * viejos aunque el tipo diga que no pueden existir.
 */
export function normalizeHistoryRoles(history: AiMessage[]): AiMessage[] {
  return history.map((message) =>
    message.role === AiRole.MODEL ? message : { ...message, role: AiRole.USER }
  );
}
