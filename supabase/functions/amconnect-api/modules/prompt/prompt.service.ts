import { SupabaseClient } from "@supabase/supabase-js";
import { handleSupabaseError } from "../../shared/errors.ts";
import { DEV_PROMPTS } from "../../prompts/dev_prompts.ts";

interface CacheEntry {
  prompt: string;
  expiresAt: number;
}

export class PromptService {
  private cache = new Map<string, CacheEntry>();

  constructor(private supabase: SupabaseClient) {}

  async getPrompt(code: string): Promise<string> {
    if (Deno.env.get("USE_FILE_PROMPTS") === "true") {
      const prompt = DEV_PROMPTS[code];
      if (!prompt) throw new Error(`[PromptService] '${code}' not found in dev_prompts.ts`);
      return prompt;
    }

    const now = Date.now();
    const cached = this.cache.get(code);

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
    this.cache.set(code, {
      prompt,
      expiresAt: now + ttlMs,
    });

    return prompt;
  }
}
