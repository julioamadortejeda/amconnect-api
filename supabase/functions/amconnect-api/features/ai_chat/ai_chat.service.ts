import { SupabaseClient } from "@supabase/supabase-js";
import { zodToJsonSchema } from "zod-to-json-schema";
import { AiMessage, AiRole, IAiProvider } from "../../core/ai_provider.interface.ts";
import { AiError } from "../../shared/errors.ts";
import { getSkillByName, getSkillsByDomains } from "./skills/index.ts";
import { SkillContext } from "./skills/skill.core.ts";
import { PlanLimits } from "../../modules/subscription/subscription.dto.ts";
import { SubscriptionService } from "../../modules/subscription/subscription.service.ts";
import { IngestionUsageData } from "../document_processing/policy_ingestion.service.ts";

const AVAILABLE_DOMAINS = ["contact", "policy", "reminder", "pending_task", "catalog"];
const POLICY_INGESTION_DOMAINS = ["policy_ingestion"];
const MAX_LOOPS = 6;

const POLICY_INGESTION_PROMPT = `
You are AmConnect processing the ingestion of an insurance policy.
The system already extracted the information from the PDF document. Your job is:
1. Present the advisor with a clear and organized summary of the data found.
2. Verify you have the critical fields: carrier, branch, holder name, start and end date, and premium.
3. If a critical field is missing, ask the advisor for it concisely.
4. When the advisor confirms (says "yes", "confirm", "go ahead", "sí", "confirma" or similar), call confirm_policy_ingestion with ALL available data.
IMPORTANT:
- Do NOT ask whether the carrier, branch, product or contact already exist — they are created automatically if they don't.
- Do NOT ask for confirmation per entity — only one final confirmation.
- Detect the language of the advisor's message and respond in that same language.
`.trim();

const SYSTEM_PROMPT = `
You are AmConnect, an intelligent assistant that helps financial and insurance advisors in Mexico manage their portfolio.
Always address the advisor in second person: use "you have", "your clients", "your portfolio" — never "I have" or "my clients".
- Detect the language of each message and respond in that same language.
- Respond naturally and professionally.
- When the user asks about a person, search for them first with search_contact.
- If a search returns no results and the user wanted to take action, ask if they want to create it. If confirmed, use the data the user already provided — do NOT ask for it again.
- To count clients or records use the counting tools — do not fetch all data just to count.
- For questions about health conditions, notes or personal information, use search_contact_notes.
- When you need to create something, do it directly without asking for confirmation unless critical data is missing.
- NEVER invent or copy values between fields to satisfy required fields. If the user did not provide a contact's full name, ask for it — do not use CURP, RFC, email or any other field as a name.
- Save data EXACTLY as the user provided it — never interpret, translate or look up external information (e.g. if they say "zócalo", save "zócalo", do not look up the real address).
- If you cannot find information, say so clearly.
- When a tool returns multiple records, decide based on the user's intent:
  - If the user requested a LIST or general query → show all results without asking.
  - If the user wants to act on a SPECIFIC record and there is ambiguity or it was not found → FIRST use save_pending_task saving all known data, THEN ask the user.
- When the user responds to an ambiguity question and you have the correct record → use resolve_pending_task and then execute the action with the data saved in the pending task.
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
    planLimits?: PlanLimits,
  ): Promise<ChatResponse> {
    if (planLimits) {
      await new SubscriptionService(this.supabase).checkChatLimit(agentId, planLimits);
    }
    const history: AiMessage[] = [];
    let currentSessionId = sessionId;

    // Cargar historial si hay sesión
    let sessionType = "chat";

    if (sessionId) {
      const { data: session } = await this.supabase
        .from("ai_sessions")
        .select("history, session_type")
        .eq("id", sessionId)
        .single();

      if (session?.history) history.push(...(session.history as AiMessage[]));
      sessionType = session?.session_type ?? "chat";
    } else {
      // Crear nueva sesión
      const { data: newSession } = await this.supabase
        .from("ai_sessions")
        .insert({ agent_id: agentId, trigger_message: message, history: [], model_name: this.aiProvider.model })
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

    // Seleccionar domains y system prompt según tipo de sesión
    const isPolicyIngestion = sessionType === "policy_ingestion";
    let activeDomains: string[];
    let classifyUsage;

    if (isPolicyIngestion) {
      activeDomains = POLICY_INGESTION_DOMAINS;
    } else {
      const ALWAYS_ACTIVE = ["catalog", "pending_task"];
      const { domains, usage } = await this.aiProvider.classifyMessage(message, AVAILABLE_DOMAINS);
      classifyUsage = usage;
      activeDomains = [...new Set([...ALWAYS_ACTIVE, ...(domains.length > 0 ? domains : AVAILABLE_DOMAINS)])];
    }

    const activeSkills = getSkillsByDomains(activeDomains);
    const tools = [{
      functionDeclarations: activeSkills.map((s) => {
        const { $schema: _, ...parameters } = zodToJsonSchema(s.declaration.schema) as Record<string, unknown>;
        return { name: s.declaration.name, description: s.declaration.description, parameters };
      }),
    }];

    // Construir system prompt con contexto de pending tasks si los hay
    let systemPrompt = isPolicyIngestion ? POLICY_INGESTION_PROMPT : SYSTEM_PROMPT;
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

  async startPolicySession(
    agentId: string,
    extraction: Record<string, unknown>,
    documentMetadataId: string,
    ingestionUsage?: IngestionUsageData,
  ): Promise<ChatResponse> {
    const { data: session } = await this.supabase
      .from("ai_sessions")
      .insert({
        agent_id: agentId,
        trigger_message: "Ingesta de póliza",
        history: [],
        session_type: "policy_ingestion",
        metadata: { extraction, documentMetadataId },
        model_name: this.aiProvider.model,
        embedding_model_name: ingestionUsage?.embeddingModelName ?? null,
        extraction_prompt_tokens: ingestionUsage?.extractionUsage.promptTokens ?? 0,
        extraction_completion_tokens: ingestionUsage?.extractionUsage.completionTokens ?? 0,
        extraction_total_tokens: ingestionUsage?.extractionUsage.totalTokens ?? 0,
        embedding_total_tokens: ingestionUsage?.embeddingTotalTokens ?? 0,
        embedding_count: ingestionUsage?.embeddingCount ?? 0,
      })
      .select()
      .single();

    const sessionId = session?.id;

    if (ingestionUsage && sessionId) {
      await this.supabase.from("ai_ingestion_usage").insert([
        {
          agent_id: agentId,
          session_id: sessionId,
          document_metadata_id: ingestionUsage.documentMetadataId,
          operation: "extraction",
          model_name: this.aiProvider.model,
          prompt_tokens: ingestionUsage.extractionUsage.promptTokens,
          completion_tokens: ingestionUsage.extractionUsage.completionTokens,
          total_tokens: ingestionUsage.extractionUsage.totalTokens,
          item_count: 1,
        },
        {
          agent_id: agentId,
          session_id: sessionId,
          document_metadata_id: ingestionUsage.documentMetadataId,
          operation: "embedding",
          model_name: ingestionUsage.embeddingModelName,
          prompt_tokens: 0,
          completion_tokens: 0,
          total_tokens: ingestionUsage.embeddingTotalTokens,
          item_count: ingestionUsage.embeddingCount,
        },
      ]);
    }

    const extractionSummary = JSON.stringify(extraction, null, 2);
    const initialMessage = `El sistema extrajo la siguiente información de la póliza:\n\`\`\`json\n${extractionSummary}\n\`\`\`\nPor favor presenta un resumen al asesor y solicita confirmación para crear la póliza.`;

    return await this.processMessage(initialMessage, agentId, sessionId);
  }
}
