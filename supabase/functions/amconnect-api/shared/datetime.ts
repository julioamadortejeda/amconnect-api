/**
 * Utilidades de fecha/hora local del asesor. Única implementación —
 * usada por el chat de texto (AiChatService) y el de voz (VoiceChatService).
 */

export const DEFAULT_TIMEZONE = "America/Mexico_City";

/** Offset del timezone en formato "-06:00". Fallback: "-06:00". */
export function calcTimezoneOffset(timezone: string): string {
  try {
    const now = new Date();
    const formatter = new Intl.DateTimeFormat("en-US", { timeZone: timezone, timeZoneName: "longOffset" });
    const tzName = formatter.formatToParts(now).find((p) => p.type === "timeZoneName")?.value ?? "";
    if (tzName === "GMT" || tzName === "UTC") return "+00:00";
    const match = tzName.match(/GMT([+-])(\d{1,2}):?(\d{2})?/);
    if (match) return `${match[1]}${match[2].padStart(2, "0")}:${(match[3] ?? "00").padStart(2, "0")}`;
  } catch (_) { /* fallback abajo */ }
  return "-06:00";
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
