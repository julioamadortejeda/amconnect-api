import { SupabaseClient } from "@supabase/supabase-js";
import { zodToJsonSchema } from "zod-to-json-schema";
import { AiMessage, AiRole, IAiProvider } from "../../core/ai_provider.interface.ts";
import { AiError } from "../../shared/errors.ts";
import { getSkillByName, getSkillsByDomains } from "./skills/index.ts";
import { SkillContext } from "./skills/skill.core.ts";

const AVAILABLE_DOMAINS = ["contact", "policy", "reminder", "pending_task", "catalog"];
const MAX_LOOPS = 6;

const SYSTEM_PROMPT = `
Eres AmConnect, un asistente inteligente que ayuda a asesores financieros y de seguros en México a gestionar su cartera.
Hablas SIEMPRE en segunda persona dirigiéndote al asesor: "tienes", "tus clientes", "tu cartera", nunca "tengo" o "mis clientes".
- Responde siempre en español, de forma natural y profesional.
- Cuando el usuario pregunte sobre una persona, búscala primero con search_contact.
- Si una búsqueda no devuelve resultados y el usuario quería hacer una acción, pregunta si desea crearlo. Si confirma, usa los datos que el usuario ya proporcionó — NO los pidas de nuevo.
- Para contar clientes o registros usa las herramientas de conteo, no traigas todos los datos solo para contar.
- Para preguntas sobre enfermedades, notas o información personal, usa search_contact_notes.
- Cuando necesites crear algo, hazlo directamente sin pedir confirmación a menos que falten datos críticos.
- NUNCA inventes ni copies valores entre campos para satisfacer campos requeridos. Si el usuario no proporcionó el nombre completo de un contacto, pregúntalo — no uses el CURP, RFC, email u otro dato como nombre.
- Guarda los datos EXACTAMENTE como los proporcionó el usuario — nunca los interpretes, traduzcas ni busques información externa (ej: si dice "zócalo", guarda "zócalo", no busques la dirección real).
- Si no encuentras información, dilo claramente.
- Cuando una herramienta devuelve múltiples registros, decide según la intención del usuario:
  - Si el usuario pidió una LISTA o consulta general (ej: "dame mis pólizas", "¿cuántos clientes se llaman Juan?", "¿qué recordatorios vencen hoy?") → muestra todos los resultados sin preguntar.
  - Si el usuario quiere actuar sobre un registro ESPECÍFICO (ej: actualizar, ver detalle, buscar notas de alguien) y hay ambigüedad o no se encontró → PRIMERO usa save_pending_task guardando todos los datos ya conocidos (ej: el teléfono nuevo, la acción a realizar), LUEGO pregunta al usuario.
- Cuando el usuario responde a una pregunta de ambigüedad y ya tienes el registro correcto → usa resolve_pending_task y luego ejecuta la acción con los datos guardados en el pending task.
`.trim();

export interface ChatResponse {
  text: string;
  sessionId: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
}

export class AiChatService {
  constructor(
    private supabase: SupabaseClient,
    private aiProvider: IAiProvider,
    private skillContext: Omit<SkillContext, "agentId" | "sessionId" | "supabase">,
  ) {}

  async cancelSession(sessionId: string): Promise<{ cancelledTasks: number }> {
    const [{ data }] = await Promise.all([
      this.supabase
        .from("ai_pending_tasks")
        .update({
          status: "cancelled",
          cancellation_reason: "user_left",
          updated_at: new Date().toISOString(),
        })
        .eq("session_id", sessionId)
        .eq("status", "pending")
        .select("id"),
      this.supabase
        .from("ai_sessions")
        .update({ status: "cancelled", updated_at: new Date().toISOString() })
        .eq("id", sessionId),
    ]);

    return { cancelledTasks: data?.length ?? 0 };
  }

  async processMessage(
    message: string,
    agentId: string,
    sessionId?: string,
  ): Promise<ChatResponse> {
    const history: AiMessage[] = [];
    let currentSessionId = sessionId;

    // Cargar historial si hay sesión
    if (sessionId) {
      const { data: session } = await this.supabase
        .from("ai_sessions")
        .select("history")
        .eq("id", sessionId)
        .single();

      if (session?.history) {
        history.push(...(session.history as AiMessage[]));
      }
    } else {
      // Crear nueva sesión
      const { data: newSession } = await this.supabase
        .from("ai_sessions")
        .insert({ agent_id: agentId, trigger_message: message, history: [] })
        .select()
        .single();
      currentSessionId = newSession?.id;
    }

    history.push({ role: AiRole.USER, parts: [{ text: message }] });

    // Cargar pending tasks activos de la sesión para darle contexto al AI
    const { data: pendingTasks } = await this.supabase
      .from("ai_pending_tasks")
      .select("id, task_type, payload")
      .eq("session_id", currentSessionId)
      .eq("status", "pending");

    // Clasificar para seleccionar tools relevantes
    // catalog y pending_task siempre activos: catalog es transversal (productos/carriers/ramos
    // aparecen en flujos de cualquier dominio), pending_task es infraestructura del chat.
    const ALWAYS_ACTIVE = ["catalog", "pending_task"];
    const { domains, usage: classifyUsage } = await this.aiProvider.classifyMessage(message, AVAILABLE_DOMAINS);
    const activeDomains = [...new Set([...ALWAYS_ACTIVE, ...(domains.length > 0 ? domains : AVAILABLE_DOMAINS)])];
    const activeSkills = getSkillsByDomains(activeDomains);
    const tools = [{
      functionDeclarations: activeSkills.map((s) => {
        const { $schema: _, ...parameters } = zodToJsonSchema(s.declaration.schema) as Record<string, unknown>;
        return { name: s.declaration.name, description: s.declaration.description, parameters };
      }),
    }];

    // Construir system prompt con contexto de pending tasks si los hay
    let systemPrompt = SYSTEM_PROMPT;
    if (pendingTasks && pendingTasks.length > 0) {
      const tasksContext = pendingTasks
        .map((t) => `- ID: ${t.id}, tipo: ${t.task_type}, datos: ${JSON.stringify(t.payload)}`)
        .join("\n");
      systemPrompt += `\n\nTareas pendientes en esta sesión que esperan resolución:\n${tasksContext}`;
    }

    const ctx: SkillContext = {
      agentId,
      sessionId: currentSessionId!,
      supabase: this.supabase,
      ...this.skillContext,
    };

    const classifyTokens = {
      promptTokens: classifyUsage?.promptTokens ?? 0,
      completionTokens: classifyUsage?.completionTokens ?? 0,
      totalTokens: classifyUsage?.totalTokens ?? 0,
    };
    const loopUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0 };

    // Bucle de function calling
    let finalText = "";
    let loops = 0;

    while (loops < MAX_LOOPS) {
      loops++;
      const result = await this.aiProvider.processUserRequest(history, tools, systemPrompt);

      if (result.usage) {
        loopUsage.promptTokens += result.usage.promptTokens;
        loopUsage.completionTokens += result.usage.completionTokens;
        loopUsage.totalTokens += result.usage.totalTokens;
      }

      if (result.text && !result.functionCalls?.length) {
        finalText = result.text;
        history.push({ role: AiRole.MODEL, parts: [{ text: result.text }] });
        break;
      }

      if (!result.functionCalls?.length) {
        throw new AiError("El modelo no devolvió texto ni function calls.");
      }

      // Ejecutar function calls
      const functionResults = [];
      history.push({ role: AiRole.MODEL, parts: result.rawModelParts as never[] });

      for (const call of result.functionCalls) {
        const skill = getSkillByName(call.name);
        let response: unknown;

        if (skill) {
          const validation = skill.declaration.schema.safeParse(call.args);
          if (!validation.success) {
            const missing = validation.error.issues
              .map((i) => `${i.path.join(".") || "campo"}: ${i.message}`)
              .join("; ");
            response = { error: `Faltan datos requeridos — ${missing}. Pídelos al usuario antes de volver a llamar este skill.` };
          } else {
            try {
              response = await skill.execute(validation.data, ctx);
            } catch (e) {
              response = { error: e instanceof Error ? e.message : "Error ejecutando la herramienta." };
            }
          }
        } else {
          response = { error: `Herramienta desconocida: ${call.name}` };
        }

        functionResults.push({
          functionResponse: { name: call.name, response: { result: response } },
        });
      }

      history.push({ role: AiRole.FUNCTION as never, parts: functionResults as never[] });
    }

    if (!finalText) {
      throw new AiError("El asistente no pudo generar una respuesta.");
    }

    const totalUsage = {
      promptTokens: classifyTokens.promptTokens + loopUsage.promptTokens,
      completionTokens: classifyTokens.completionTokens + loopUsage.completionTokens,
      totalTokens: classifyTokens.totalTokens + loopUsage.totalTokens,
    };

    const [, { error: msgError }, { error: usageError }] = await Promise.all([
      this.supabase.from("ai_sessions")
        .update({ history, updated_at: new Date().toISOString() })
        .eq("id", currentSessionId),
      this.supabase.from("ai_chat_messages").insert([
        { session_id: currentSessionId, agent_id: agentId, role: "user", content: message, prompt_tokens: 0, completion_tokens: 0, total_tokens: 0 },
        {
          session_id: currentSessionId, agent_id: agentId, role: "classify", content: null,
          prompt_tokens: classifyTokens.promptTokens,
          completion_tokens: classifyTokens.completionTokens,
          total_tokens: classifyTokens.totalTokens,
        },
        {
          session_id: currentSessionId, agent_id: agentId, role: "model", content: finalText,
          prompt_tokens: loopUsage.promptTokens,
          completion_tokens: loopUsage.completionTokens,
          total_tokens: loopUsage.totalTokens,
        },
      ]),
      this.supabase.rpc("increment_session_usage", {
        p_session_id: currentSessionId,
        p_prompt_tokens: totalUsage.promptTokens,
        p_completion_tokens: totalUsage.completionTokens,
        p_total_tokens: totalUsage.totalTokens,
      }),
    ]);

    console.log("[ai_chat:diag] messages:", msgError ? msgError.message : "ok");
    console.log("[ai_chat:diag] usage:", usageError ? usageError.message : "ok");

    return { text: finalText, sessionId: currentSessionId!, usage: totalUsage };
  }
}
