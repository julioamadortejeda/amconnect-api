/**
 * Evidencia de una petición (IP, dispositivo, app, idioma) para la bitácora de
 * consentimientos. La captura el SERVIDOR de los headers: el cuerpo del request
 * nunca trae estos datos, así el cliente no los declara.
 */
export interface RequestEvidence {
  ip: string | null;
  userAgent: string | null;
  appVersion: string | null;
  platform: "ios" | "android" | "web" | null;
  locale: "es" | "en" | null;
}

type HeaderReader = { get(name: string): string | null };

/** Quita puerto y corchetes: "1.2.3.4:5678" -> "1.2.3.4", "[::1]:80" -> "::1". */
function cleanIp(raw: string): string | null {
  let ip = raw.trim();
  if (!ip) return null;
  const bracket = ip.match(/^\[([^\]]+)\](?::\d+)?$/);
  if (bracket) ip = bracket[1];
  else if (/^\d+\.\d+\.\d+\.\d+:\d+$/.test(ip)) ip = ip.split(":")[0];
  return ip;
}

/**
 * IP del cliente. Supabase Edge está detrás de un proxy: la IP real viaja en
 * `x-forwarded-for` (el primer elemento es el cliente original); se prueban
 * `x-real-ip` y `cf-connecting-ip` como respaldo. La base la valida como inet
 * (si no es válida guarda null), aquí solo se normaliza.
 */
export function extractClientIp(headers: HeaderReader): string | null {
  const forwarded = headers.get("x-forwarded-for")?.split(",")[0];
  for (const candidate of [forwarded, headers.get("x-real-ip"), headers.get("cf-connecting-ip")]) {
    const ip = candidate ? cleanIp(candidate) : null;
    if (ip) return ip;
  }
  return null;
}

/** `x-locale` o, si falta, `Accept-Language`, normalizado a es/en (otro idioma -> es). */
export function normalizeLocale(headers: HeaderReader): "es" | "en" | null {
  const raw = headers.get("x-locale") ?? headers.get("accept-language");
  if (!raw) return null;
  const lang = raw.split(",")[0].split(";")[0].trim().split(/[-_]/)[0].toLowerCase();
  if (!lang) return null;
  return lang === "en" ? "en" : "es";
}

function clean(value: string | null, max: number): string | null {
  const v = value?.trim();
  return v ? v.slice(0, max) : null;
}

export function extractRequestEvidence(headers: HeaderReader): RequestEvidence {
  const platform = headers.get("x-platform")?.trim().toLowerCase();
  return {
    ip: extractClientIp(headers),
    userAgent: clean(headers.get("user-agent"), 500),
    appVersion: clean(headers.get("x-app-version"), 50),
    platform: platform === "ios" || platform === "android" || platform === "web" ? platform : null,
    locale: normalizeLocale(headers),
  };
}
