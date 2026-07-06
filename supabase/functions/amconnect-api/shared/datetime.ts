/**
 * Utilidades de fecha/hora local del asesor. Única implementación —
 * usada por el chat de texto (AiChatService) y el de voz (VoiceChatService).
 */

export const DEFAULT_TIMEZONE = "America/Mexico_City";

function isValidTimeZone(tz: string): boolean {
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: tz });
    return true;
  } catch (_) {
    return false;
  }
}

/**
 * Normaliza el timezone que reporta el cliente a un valor que Intl acepte.
 * Los clientes no siempre mandan un nombre IANA: iOS reporta abreviaturas
 * ("CST" → Intl lo acepta pero lo lee como America/Chicago, 1h corrido en
 * verano) y Android puede mandar "GMT-06:00" o nombres localizados (→ Intl
 * truena y antes se caía a la hora UTC del servidor). Orden de resolución:
 *   1. `tz` si es un nombre IANA canónico (contiene "/", o UTC/GMT).
 *   2. `offset` ("-06:00", header x-timezone-offset) — V8 acepta offsets como
 *      timeZone; pierde DST en fechas lejanas pero siempre da la hora correcta "ahora".
 *   3. `tz` aunque sea abreviatura, si Intl lo acepta (mejor aproximación que el default).
 *   4. DEFAULT_TIMEZONE.
 */
export function resolveTimezone(tz?: string | null, offset?: string | null): string {
  const tzIsValid = !!tz && isValidTimeZone(tz);
  const tzIsCanonical = tzIsValid && (tz!.includes("/") || /^(UTC|GMT)$/i.test(tz!));
  if (tzIsCanonical) return tz!;
  if (offset && /^[+-]\d{2}:\d{2}$/.test(offset) && isValidTimeZone(offset)) return offset;
  if (tzIsValid) return tz!;
  return DEFAULT_TIMEZONE;
}

/** Offset del timezone en formato "-06:00", calculado en el instante `at`
 *  (default: ahora) — relevante en zonas con horario de verano. Fallback: "-06:00". */
export function calcTimezoneOffset(timezone: string, at: Date = new Date()): string {
  try {
    const formatter = new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "longOffset" });
    const tzName = formatter.formatToParts(at).find((p) => p.type === "timeZoneName")?.value ?? "";
    if (tzName === "GMT" || tzName === "UTC") return "+00:00";
    const match = tzName.match(/GMT([+-])(\d{1,2}):?(\d{2})?/);
    if (match) return `${match[1]}${match[2].padStart(2, "0")}:${(match[3] ?? "00").padStart(2, "0")}`;
  } catch (_) { /* fallback abajo */ }
  return "-06:00";
}

/**
 * Convierte un timestamp UTC (como lo serializa PostgREST: "2026-07-06T16:00:00+00:00")
 * al ISO local del asesor con offset ("2026-07-06T10:00:00-06:00"). Pensado para que
 * las skills entreguen fechas ya locales al modelo en vez de delegarle la conversión.
 * Si el timezone no es válido o el valor no parsea, devuelve el valor original (UTC
 * explícito es preferible a una conversión inventada).
 */
export function utcToLocalIso(utcIso: string | null | undefined, timezone: string): string | null {
  if (!utcIso) return null;
  const date = new Date(utcIso);
  if (isNaN(date.getTime())) return utcIso;
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(date);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
    const offsetStr = calcTimezoneOffset(timezone, date);
    return `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}${offsetStr}`;
  } catch (_) {
    return utcIso;
  }
}

export interface LocalDateTime {
  /** ISO local con offset, ej: "2026-07-04T19:30:00-06:00" */
  localIso: string;
  /** Offset, ej: "-06:00" */
  offsetStr: string;
}

/** Fecha/hora actual en el timezone del asesor, lista para inyectar en el contexto del AI. */
export function buildLocalDateTime(timezone: string = DEFAULT_TIMEZONE): LocalDateTime {
  const now = new Date();
  const offsetStr = calcTimezoneOffset(timezone);
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hour12: false,
    }).formatToParts(now);
    const get = (t: string) => parts.find((p) => p.type === t)?.value ?? "00";
    return {
      localIso: `${get("year")}-${get("month")}-${get("day")}T${get("hour")}:${get("minute")}:${get("second")}${offsetStr}`,
      offsetStr,
    };
  } catch (_) {
    // Fallback: hora del servidor con su propio offset
    const offsetMin = -now.getTimezoneOffset();
    const sign = offsetMin >= 0 ? "+" : "-";
    const pad = (n: number) => String(Math.abs(n)).padStart(2, "0");
    const serverOffset = `${sign}${pad(Math.floor(Math.abs(offsetMin) / 60))}:${pad(Math.abs(offsetMin) % 60)}`;
    const localIso = new Date(now.getTime() + offsetMin * 60 * 1000).toISOString().slice(0, 19) + serverOffset;
    return { localIso, offsetStr: serverOffset };
  }
}
