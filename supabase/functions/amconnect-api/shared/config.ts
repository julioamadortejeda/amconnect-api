// Modelos SIN fallback (fail closed, igual que los secretos — RULES §6): si
// falta la env var, el boot truena con mensaje claro en vez de operar con un
// modelo por defecto que nadie pidió. El DI valida además que cada modelo
// exista y esté activo en ai_models (catálogo de precios).
export function requireEnv(name: string): string {
  const value = Deno.env.get(name)?.trim();
  if (!value) {
    throw new Error(`[CONFIG] ${name} no está configurada y no hay fallback (fail closed). Defínela en .env.local / secrets.`);
  }
  return value;
}

export const AI_MODEL = requireEnv("GEMINI_MODEL");

const IS_VERTEX = Deno.env.get("AI_BACKEND")?.trim().toLowerCase() === "vertex";

// Nombre del backend activo, expuesto al cliente en las respuestas de chat y
// voz para el badge Free/Enterprise de la app.
export const AI_BACKEND_NAME: "studio" | "vertex" = IS_VERTEX ? "vertex" : "studio";

// El modelo live se resuelve por backend: los nombres difieren entre AI Studio
// y Vertex y ninguno existe en ambos (verificado 2026-07-08). Studio rechaza
// gemini-live-2.5-flash-native-audio (1008) y Vertex no tiene el live-preview.
export const LIVE_AUDIO_MODEL = IS_VERTEX
  ? requireEnv("VERTEX_LIVE_MODEL")
  : requireEnv("GEMINI_LIVE_MODEL");

// Hardcodeado A PROPÓSITO (no env): cambiar el modelo de embeddings invalida
// todos los vectores de agent_note_chunks y exige reindexar. Debe ser difícil
// de cambiar por accidente.
export const EMBEDDING_MODEL = "gemini-embedding-2";
