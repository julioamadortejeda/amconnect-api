/**
 * El idioma del asesor, tal como se le nombra al modelo.
 *
 * Sale del header `Accept-Language` que manda la app en cada peticion. Solo
 * distingue ingles de espanol porque son los dos idiomas de la app (las dos
 * unicas traducciones en l10n); cualquier otra cosa cae a espanol, que es el
 * default del producto en Mexico.
 *
 * Se le pasa a los prompts conversacionales como `{{advisor_language}}`, igual
 * que a los de ingesta. No dicta el idioma de la respuesta —eso lo decide el
 * mensaje del asesor— sino que desempata cuando el mensaje no tiene idioma:
 * un nombre, "ok", "el segundo", un numero. Sin ese desempate el modelo elige
 * por su cuenta, y despues de leer 20,000 caracteres de instrucciones en ingles
 * se inclina al ingles.
 */
export function languageName(locale?: string | null): string {
  const raw = (locale ?? "").split(/[-_]/)[0].toLowerCase();
  return raw === "en" ? "English" : "Spanish";
}

/** El `Accept-Language` de la peticion, ya recortado al codigo de idioma. */
export function localeFromHeader(header?: string | null): string {
  return header?.split(",")[0]?.split(";")[0]?.trim() || "es";
}

/**
 * Cualquier etiqueta de idioma ('en_US', 'es-MX', 'EN', ' es ') al par que SI
 * se guarda en `agents.locale`: 'es' | 'en'. Lo que no es ninguno de los dos
 * (vacio, 'fr', basura) es null: no se adivina un idioma que la app no tiene.
 */
export function normalizeAppLocale(value?: string | null): "es" | "en" | null {
  const lang = (value ?? "").split(",")[0].split(";")[0].trim().split(/[-_]/)[0].toLowerCase();
  return lang === "es" || lang === "en" ? lang : null;
}

/**
 * Decision de D-024: cuando se escribe `agents.locale` desde el header.
 * Devuelve el valor a guardar, o null si no hay que escribir nada.
 *
 * El idioma del asesor lo elige el asesor (Preferencias → PATCH /agents/me).
 * El header solo LLENA el vacio: si lo guardado ya es exactamente 'es' o 'en'
 * no se toca, aunque el telefono mande otro idioma. Si esta vacio o es un valor
 * legado ('en_US', 'es-MX') se guarda el header normalizado.
 */
export function localeToBackfill(header?: string | null, stored?: string | null): "es" | "en" | null {
  if (stored === "es" || stored === "en") return null;
  return normalizeAppLocale(header);
}
