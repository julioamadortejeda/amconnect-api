// ═══════════════════════════════════════════════════════════════════════════
//  CONFIGURACIÓN DEL ASISTENTE — qué herramientas se le ofrecen al modelo
// ═══════════════════════════════════════════════════════════════════════════
//
// Este es el ÚNICO lugar donde se cambia esto. Al editarlo hay que volver a
// desplegar la Edge Function (`supabase functions deploy amconnect-api`); no
// hace falta migración ni variable de entorno.
//
// ─── TOOL_SELECTION_MODE ───────────────────────────────────────────────────
//
// Cómo se eligen las herramientas (function calling) del chat de texto. La voz
// NO lee este valor: sigue con su propio conjunto fijo.
//
//   "all"        Se ofrecen TODAS las herramientas en cada turno, siempre en el
//                mismo orden (el del registro de skills), idéntico entre turnos
//                y entre asesores: así el prefijo (instrucciones + herramientas)
//                es estable y el implicit caching de Gemini lo reutiliza.
//                NO se llama al clasificador de intención (un LLM menos por
//                mensaje). La única herramienta que puede faltar es
//                `resolve_pending_task`, que se omite cuando no hay tareas
//                pendientes. El idioma de respuesta se detecta con una función
//                local (`detectReplyLanguage`), sin llamar a ningún modelo.
//
//   "by_domain"  Comportamiento anterior: el clasificador (una llamada al LLM)
//                devuelve dominios + idioma y `resolveChatDomains` decide qué
//                herramientas viajan; quedan fijas durante todo el turno.
//
// Para REVERTIR al comportamiento anterior: cambia el valor de abajo a
// "by_domain" y vuelve a desplegar. El código de ambos caminos sigue en
// `features/ai_chat/ai_chat.service.ts`.
export type ToolSelectionMode = "all" | "by_domain";

export const TOOL_SELECTION_MODE: ToolSelectionMode = "all";
