/**
 * Días de la semana en inglés calculados por código. El modelo se equivoca al
 * derivar el día de la semana de una fecha ISO ("jueves 27" cuando era viernes),
 * así que se le entrega ya calculado. Funciones puras: operan sobre la fecha
 * LOCAL del asesor (YYYY-MM-DD), nunca sobre el día UTC del servidor.
 */

const LONG = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function utcMidnight(ymd: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return null;
  const d = new Date(`${ymd}T00:00:00Z`);
  return isNaN(d.getTime()) ? null : d;
}

/** Día de la semana ("Friday") de una fecha local YYYY-MM-DD. Un ISO local con hora/offset
 *  también sirve: solo se lee su parte de fecha (ya es local). null si no parsea. */
export function weekdayOfLocalDate(localDateOrIso: string | null | undefined): string | null {
  if (!localDateOrIso) return null;
  const d = utcMidnight(localDateOrIso.slice(0, 10));
  return d ? LONG[d.getUTCDay()] : null;
}

/** Día de la semana de un instante (ej. timestamptz UTC de la BD) en el timezone del asesor. */
export function weekdayInTimezone(instantIso: string | null | undefined, timezone: string): string | null {
  if (!instantIso) return null;
  const at = new Date(instantIso);
  if (isNaN(at.getTime())) return null;
  try {
    return new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "long" }).format(at);
  } catch (_) {
    return null;
  }
}

/** Los `count` días siguientes a la fecha local `localDate`, ej. "Tue 2026-11-24". */
export function nextDaysLine(localDate: string, count = 7): string {
  const start = utcMidnight(localDate.slice(0, 10));
  if (!start) return "";
  const out: string[] = [];
  for (let i = 1; i <= count; i++) {
    const d = new Date(start.getTime() + i * 86_400_000);
    out.push(`${LONG[d.getUTCDay()].slice(0, 3)} ${d.toISOString().slice(0, 10)}`);
  }
  return out.join(", ");
}
