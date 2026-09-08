import { SupabaseClient } from "@supabase/supabase-js";
import { handleSupabaseError } from "../../shared/errors.ts";
import { DEV_PROMPTS } from "../../prompts/dev_prompts.ts";

interface CacheEntry {
  prompt: string;
  expiresAt: number;
}

export class PromptService {
  // Cache estática: PromptService se instancia por request en el DI, así que
  // una cache de instancia moriría con cada request y todos los mensajes de
  // chat harían SELECT a system_prompts. A nivel de clase sobrevive mientras
  // el isolate del Edge Runtime esté caliente.
  private static cache = new Map<string, CacheEntry>();

  constructor(private supabase: SupabaseClient) {}

  /**
   * Devuelve el prompt ya listo para el modelo.
   *
   * `vars` son los valores de los placeholders `{{como_este}}` del texto. Si el
   * prompt declara uno y no viene su valor, esto TRUENA — a proposito. El caso
   * que lo justifica: tres prompts de ingesta traian `{{current_date}}` y nadie
   * lo sustituia, asi que al modelo le llegaban las llaves escritas tal cual y
   * ademas se le pedia resolver "noviembre" contra una fecha que nunca recibio.
   * Nada fallo, nada se registro; solo salian resumenes peores. Un prompt con
   * placeholders sin resolver ya esta produciendo basura en silencio, y es mejor
   * que se caiga a la vista.
   */
  async getPrompt(code: string, vars: Record<string, string> = {}): Promise<string> {
    const raw = await this.loadPrompt(code);
    return PromptService.parsePrompt(code, raw, vars);
  }

  /**
   * Sustituye los `{{placeholders}}` del texto.
   *
   * Se valida la PLANTILLA, nunca el resultado: los valores que se inyectan
   * pueden ser contenido del asesor (el excerpt de una nota, su propio mensaje)
   * y una nota que casualmente contenga llaves dobles no tiene por que tumbar
   * la ingesta.
   *
   * Solo se validan las llaves DOBLES. Las simples aparecen dentro de los
   * prompts como ejemplos de JSON —el del clasificador dice literalmente
   * `{ "domains": [...] }`— y tratarlas como placeholders daria falsos
   * positivos en cada llamada.
   */
  private static parsePrompt(code: string, raw: string, vars: Record<string, string>): string {
    const declarados = new Set((raw.match(/\{\{[a-zA-Z_][a-zA-Z0-9_]*\}\}/g) ?? []));
    const faltantes = [...declarados].filter((p) => !(p.slice(2, -2) in vars));
    if (faltantes.length > 0) {
      throw new Error(
        `[PromptService] '${code}' declara ${faltantes.join(", ")} y nadie mando su valor.`,
      );
    }

    // Se sustituyen las DOS formas, `{{doble}}` y `{simple}`, aunque solo la
    // doble se valide. No es indecision: durante el despliegue hay minutos en
    // que la BD ya migro y la funcion todavia no, o al reves, y una version que
    // solo entienda una forma deja el prompt del clasificador sin su lista de
    // dominios justo en esa ventana. Aceptar ambas la vuelve inofensiva. La
    // rama simple se puede borrar cuando produccion ya no tenga llaves simples.
    let out = raw;
    const sinUsar: string[] = [];
    for (const [clave, valor] of Object.entries(vars)) {
      const antes = out;
      out = out.replaceAll(`{{${clave}}}`, valor).replaceAll(`{${clave}}`, valor);
      if (out === antes) sinUsar.push(clave);
    }
    // No es fatal —el prompt sale correcto igual— pero casi siempre es una
    // variable mal escrita del lado de quien llama.
    if (sinUsar.length > 0) {
      console.warn(`[PromptService] '${code}' recibio variables que no aparecen en el texto: ${sinUsar.join(", ")}`);
    }

    return out;
  }

  private async loadPrompt(code: string): Promise<string> {
    if (Deno.env.get("USE_FILE_PROMPTS") === "true") {
      const prompt = DEV_PROMPTS[code];
      if (!prompt) throw new Error(`[PromptService] '${code}' not found in dev_prompts.ts`);
      return prompt;
    }

    const now = Date.now();
    const cached = PromptService.cache.get(code);

    if (cached && cached.expiresAt > now) {
      return cached.prompt;
    }

    // Cache miss or expired, fetch from DB
    const { data, error } = await this.supabase
      .from("system_prompts")
      .select("prompt")
      .eq("code", code)
      .eq("is_active", true)
      .single();

    if (error) {
      handleSupabaseError(error, `Error al obtener el prompt del sistema para el código: ${code}`);
    }

    const prompt = data.prompt;

    // Calculate TTL
    const ttlMinutesStr = Deno.env.get("PROMPT_CACHE_TTL_MINUTES");
    let ttlMinutes = 1440; // Default 24 hours
    if (ttlMinutesStr) {
      const parsed = parseInt(ttlMinutesStr, 10);
      if (!isNaN(parsed)) {
        ttlMinutes = parsed;
      }
    }
    const ttlMs = ttlMinutes * 60 * 1000;

    // Cache the result
    PromptService.cache.set(code, {
      prompt,
      expiresAt: now + ttlMs,
    });

    return prompt;
  }
}
