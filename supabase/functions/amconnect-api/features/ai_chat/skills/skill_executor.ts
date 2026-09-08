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
    // Solo que falto: el "preguntale al asesor en vez de inventarlo" ya es regla
    // del prompt ("NEVER invent or copy values between fields to satisfy
    // required fields"), y cada schema dice en su required_error que espera.
    return {
      response: { error: `Missing required data — ${missing}` },
    };
  }

  // Solo los NOMBRES de los parámetros, nunca los valores: los args traen
  // nombres, teléfonos y direcciones de clientes y eso no puede ir al log
  // (LFPDPPP). Las llaves solas bastan para lo que se necesita saber — qué
  // campos mandó el modelo — y fue justo lo que faltó para diagnosticar el
  // "ponlo en progreso" que no guardó nada (2026-08-13).
  const argKeys = validation.data && typeof validation.data === "object"
    ? Object.keys(validation.data as Record<string, unknown>)
    : [];
  console.warn(`[SKILL] "${name}" args: [${argKeys.join(", ")}]`);

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
    // `ok: false` es explicito a proposito: un `error` suelto con un mensaje
    // corto se le colo al modelo como si fuera un resultado valido y termino
    // confirmandole al asesor un cambio que nunca ocurrio. El campo es lo que
    // rompe esa ambiguedad —no se puede leer como exito— y que hacer con el lo
    // dice el prompt, en READING TOOL RESULTS y en WRITE ACTIONS.
    return {
      response: { ok: false, error: msg },
    };
  }
}
