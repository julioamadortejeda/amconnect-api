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
