import { getSkillByName } from "./index.ts";
import type { SkillContext } from "./skill.core.ts";

export interface SkillExecutionResult {
  /** Lo que se envía al modelo como resultado de la herramienta. */
  response: unknown;
  /** Metadata interceptada (__skillMetadata) — para el cliente, NO para el modelo. */
  metadata?: Record<string, unknown>;
}

/**
 * Ejecuta una skill por nombre con validación Zod, manejo de errores y
 * extracción de __skillMetadata. Única implementación — usada por el loop de
 * function calling del chat de texto y por los dos caminos del chat de voz.
 * Los mensajes de error van en inglés: son para el modelo, no para el usuario.
 */
export async function executeSkill(
  name: string,
  args: unknown,
  ctx: SkillContext,
): Promise<SkillExecutionResult> {
  const skill = getSkillByName(name);
  if (!skill) {
    return { response: { error: `Unknown skill: ${name}` } };
  }

  const validation = skill.declaration.schema.safeParse(args);
  if (!validation.success) {
    const missing = validation.error.issues
      .map((i: { path: (string | number)[]; message: string }) => `${i.path.join(".") || "field"}: ${i.message}`)
      .join("; ");
    return {
      response: { error: `Missing required data — ${missing}. Ask the user before calling this skill again.` },
    };
  }

  try {
    const raw = await skill.execute(validation.data, ctx);
    if (raw && typeof raw === "object" && "__skillMetadata" in (raw as Record<string, unknown>)) {
      const { __skillMetadata, ...rest } = raw as Record<string, unknown>;
      return { response: rest, metadata: __skillMetadata as Record<string, unknown> };
    }
    return { response: raw };
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Error executing skill.";
    console.error(`[SKILL] "${name}" threw: ${msg}`);
    // El sobre de fallo es explícito a propósito: un `error` suelto con un
    // mensaje corto en español se le ha colado al modelo como si fuera un
    // resultado válido, y terminó confirmándole al asesor un cambio que nunca
    // ocurrió. `ok: false` + la instrucción no dejan lugar a interpretación.
    return {
      response: {
        ok: false,
        error: msg,
        instruction:
          "This action FAILED and nothing was saved. Tell the advisor plainly that it could not be " +
          "completed, and why. NEVER report this as done or successful.",
      },
    };
  }
}
