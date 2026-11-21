// ═══════════════════════════════════════════════════════════════════════════
//  CONFIGURACIÓN DE SEGURIDAD — CORS y límite de peticiones por minuto (D-027)
// ═══════════════════════════════════════════════════════════════════════════
//
// Este es el ÚNICO lugar donde se cambian estos valores. Al editarlos hay que
// volver a desplegar la Edge Function (`supabase functions deploy amconnect-api`);
// no hace falta migración: la BD solo guarda los contadores y recibe los números
// desde aquí en cada petición.

// ─── CORS: orígenes de navegador permitidos ────────────────────────────────
//
// Vacío = ningún navegador puede llamar al API desde una página web. La app
// móvil NO usa CORS (no manda `Origin` ni hace preflight), así que no le afecta.
// Cuando exista la web, agrega aquí su dominio EXACTO, con esquema y sin "/"
// final, por ejemplo:
//     export const CORS_ALLOWED_ORIGINS = ["https://app.amconnect.mx"];
// Nunca pongas "*": abriría el API a cualquier página.
export const CORS_ALLOWED_ORIGINS: readonly string[] = [];

// ─── Límite de peticiones por asesor ───────────────────────────────────────
//
// Cada asesor tiene dos cupos independientes; cada petición gasta de UNO solo:
//   - `ai`:      el asistente (`/ai/*`), que es lo que cuesta dinero en Gemini.
//   - `general`: todo lo demás (clientes, pólizas, recordatorios, catálogos...).
// `limit` = cuántas peticiones caben en `windowSeconds` segundos. Se cuenta con
// ventana deslizante: no se reinicia de golpe al cambiar el minuto.
// Al pasarse, el API responde 429 con errorCode `RATE_LIMITED` y el header
// `Retry-After` (segundos que conviene esperar).
// `windowSeconds` debe estar entre 1 y 3600 (lo valida la función SQL).
export const RATE_LIMITS = {
  general: { limit: 60, windowSeconds: 60 },
  ai: { limit: 20, windowSeconds: 60 },
} as const;

export type RateLimitBucket = keyof typeof RATE_LIMITS;

// Rutas de `/ai/*` que NO gastan del cupo `ai` sino del `general`. Son la
// plomería de una conversación de voz ya abierta: el modelo puede pedir varias
// herramientas por turno (`execute-tool`) y cada turno guarda su ronda
// (`save-round`). No abren una sesión nueva de Gemini; con 20/min una plática
// de voz ágil se cortaría a media frase. Abrir la voz (`/ai/voice/token`,
// `/ai/voice/init`, ...) sí gasta del cupo `ai`.
// Formato: "MÉTODO /ruta" sin el prefijo /amconnect-api.
export const AI_ROUTES_IN_GENERAL_BUCKET: ReadonlySet<string> = new Set([
  "POST /ai/voice/execute-tool",
  "POST /ai/voice/save-round",
]);

// Sin límite: `/health`, `/openapi.json` y los endpoints internos del cron
// (`/notifications/send-due`, `/reminders/generate-due`). No se configuran aquí
// porque se montan en index.ts ANTES de la autenticación y del límite: sin
// asesor no hay a quién contarle.

// Si el contador (la BD) falla, la petición PASA (fail-open) y se registra
// `[RATE_LIMIT]` en los logs. Razón: si la BD no responde, la petición va a
// fallar de todos modos en su primera consulta; y lo que cuesta dinero sigue
// protegido por la cuota mensual del plan, que se cobra en la BD y SÍ falla
// cerrado. Cerrar aquí convertiría un tropiezo del contador en un apagón total.
