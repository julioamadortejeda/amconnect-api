import { zodToJsonSchema } from "zod-to-json-schema";
import { AiMessage, AiRole, IAiProvider } from "../../core/ai_provider.interface.ts";
import { AiSessionService } from "./ai_session.service.ts";
import { AiError, AiProviderError } from "../../shared/errors.ts";
import { getSkillsByDomains } from "./skills/index.ts";
import { executeSkill } from "./skills/skill_executor.ts";
import { SkillContext } from "./skills/skill.core.ts";
import { buildLocalDateTime, DEFAULT_TIMEZONE } from "../../shared/datetime.ts";
import { PromptService } from "../../modules/prompt/prompt.service.ts";
import type { PolicyChange } from "../document_processing/policy_diff.ts";
import { AiChatContext } from "./ai.dto.ts";

const AVAILABLE_DOMAINS = ["contact", "policy", "reminder", "pending_task", "catalog", "knowledge"];
const POLICY_INGESTION_DOMAINS = ["policy_ingestion"];
const MAX_LOOPS = 6;

export interface ChatResponse {
  text: string;
  sessionId: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number; cachedTokens?: number };
  sessionUsage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  metadata?: Record<string, unknown>;
}

export class AiChatService {
  constructor(
    private aiProvider: IAiProvider,
    private skillContext: Omit<SkillContext, "agentId" | "sessionId" | "aiSessionService" | "timezone" | "timezoneOffset">,
    private aiSessionService: AiSessionService,
    private promptService: PromptService,
  ) {}

  async cancelSession(sessionId: string): Promise<{ cancelledTasks: number }> {
    return await this.aiSessionService.cancelSession(sessionId);
  }

  async processMessage(
    message: string,
    agentId: string,
    sessionId?: string | null,
    timezone?: string,
    context?: AiChatContext | null,
    newSessionType: "chat" | "chat_tts" = "chat",
  ): Promise<ChatResponse> {
    const history: AiMessage[] = [];
    const sId = sessionId ?? undefined;
    let currentSessionId = sId;

    // Cargar historial si hay sesión
    let sessionType: string = newSessionType;
    let lastInteractionId: string | undefined = undefined;

    if (sId) {
      const session = await this.aiSessionService.getSessionContext(sId);
      if (session?.history) history.push(...(session.history as AiMessage[]));
      sessionType = session?.type ?? newSessionType;
      lastInteractionId = session?.last_interaction_id ?? undefined;
    } else {
      // Crear nueva sesión
      currentSessionId = await this.aiSessionService.createSession(agentId, {
        triggerMessage: message,
        sessionType: newSessionType,
        modelName: this.aiProvider.model,
      });
    }

    // Cargar pending tasks activos de la sesión para darle contexto al AI
    const pendingTasks = await this.aiSessionService.getActivePendingTasks(currentSessionId!);

    // Seleccionar domains y system prompt según tipo de sesión
    const isPolicyIngestion = sessionType === "policy_ingestion";
    let activeDomains: string[];
    let classifyUsage;

    if (isPolicyIngestion) {
      activeDomains = POLICY_INGESTION_DOMAINS;
    } else {
      // TODO: Previously 'catalog' was always active. Kept as dynamic load to save tokens.
      const ALWAYS_ACTIVE = ["pending_task", "knowledge"];
      const { domains, usage } = await this.aiProvider.classifyMessage(message, AVAILABLE_DOMAINS);
      classifyUsage = usage;
      
      const parsedDomains = domains.length > 0 ? domains : AVAILABLE_DOMAINS;
      
      // If a screen context domain is supplied, ensure the domain is active
      if (context && !parsedDomains.includes(context.type)) {
        parsedDomains.push(context.type);
      }

      // If policy is active, we also activate catalog since policy tasks depend on catalog lookup
      if (parsedDomains.includes("policy") && !parsedDomains.includes("catalog")) {
        parsedDomains.push("catalog");
      }
      
      activeDomains = [...new Set([...ALWAYS_ACTIVE, ...parsedDomains])];
    }

    const activeSkills = getSkillsByDomains(activeDomains);
    const tools = [{
      functionDeclarations: activeSkills.map((s) => {
        const { $schema: _, ...parameters } = zodToJsonSchema(s.declaration.schema) as Record<string, unknown>;
        return { name: s.declaration.name, description: s.declaration.description, parameters };
      }),
    }];

    // Fecha y hora local del asesor — implementación compartida con voz
    const { localIso, offsetStr } = buildLocalDateTime(timezone || DEFAULT_TIMEZONE);

    // System instruction 100% estático — sin sustituciones dinámicas.
    // Gemini implicit caching aplica cuando el prefijo es idéntico entre requests.
    const dbPromptCode = isPolicyIngestion ? "policy_ingestion_system" : "ai_chat_system";
    const systemInstruction = await this.promptService.getPrompt(dbPromptCode);

    // Contexto dinámico (fecha/hora, pending tasks) va en el mensaje del usuario,
    // no en systemInstruction, para no romper el caching del prefix estático.
    const contextLines = [`[CONTEXT] Current date/time: ${localIso} | Timezone offset: ${offsetStr}`];
    if (pendingTasks.length > 0) {
      const tasksText = pendingTasks
        .map((t) => `- ID: ${t.id}, tipo: ${t.taskType}, datos: ${JSON.stringify(t.payload)}`)
        .join("\n");
      contextLines.push(`Active pending tasks requiring resolution:\n${tasksText}`);
    }
    if (context) {
      contextLines.push(
        `Active screen context (${context.type}${context.id ? ` ID: ${context.id}` : ""}):\n${JSON.stringify(context.data, null, 2)}`
      );
    }
    const contextPrefix = contextLines.join("\n") + "\n\n";

    history.push({ role: AiRole.USER, parts: [{ text: contextPrefix + message }] });

    const ctx: SkillContext = {
      agentId,
      sessionId: currentSessionId!,
      aiSessionService: this.aiSessionService,
      ...this.skillContext,
      timezone: timezone || "America/Mexico_City",
      timezoneOffset: offsetStr || "-06:00",
    };

    const classifyTokens = {
      promptTokens: classifyUsage?.promptTokens ?? 0,
      completionTokens: classifyUsage?.completionTokens ?? 0,
      totalTokens: classifyUsage?.totalTokens ?? 0,
    };
    const loopUsage = { promptTokens: 0, completionTokens: 0, totalTokens: 0, cachedTokens: 0 };

    // Bucle de function calling
    let finalText = "";
    let loops = 0;
    let forceNextTurnToGenerateText = false;
    let skillMetadata: Record<string, unknown> | undefined;
    let nextInteractionInput: string | Record<string, unknown>[] = contextPrefix + message;

    try {
    while (loops < MAX_LOOPS) {
      loops++;
      const currentTools = forceNextTurnToGenerateText ? [] : tools;
      const result = await this.aiProvider.processInteraction(
        nextInteractionInput,
        currentTools,
        systemInstruction,
        lastInteractionId,
        history,
      );

      if (result.interactionId) {
        lastInteractionId = result.interactionId;
      }

      if (result.usage) {
        loopUsage.promptTokens += result.usage.promptTokens;
        loopUsage.completionTokens += result.usage.completionTokens;
        loopUsage.totalTokens += result.usage.totalTokens;
        loopUsage.cachedTokens += result.usage.cachedTokens ?? 0;
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
      const functionResponseSteps: Record<string, unknown>[] = [];
      history.push({ role: AiRole.MODEL, parts: result.rawModelParts as never[] });

      for (const call of result.functionCalls) {
        // Recuperar el id del step original de la llamada para mapearlo al response de la Interactions API
        const originalStep = result.rawModelParts?.find(
          // deno-lint-ignore no-explicit-any
          (p: any) => p.functionCall && p.functionCall.name === call.name,
        );
        // deno-lint-ignore no-explicit-any
        const callId = (originalStep as any)?.functionCall?.id || `call_${Math.random().toString(36).substring(7)}`;

        const execution = await executeSkill(call.name, call.args, ctx);
        if (execution.metadata) skillMetadata = execution.metadata;
        const response = execution.response;

        // Si la base de conocimiento o notas de contacto devuelven vacío, forzamos que en el siguiente turno genere texto directo
        if (call.name === "search_knowledge" || call.name === "search_contact_notes") {
          if (Array.isArray(response) && response.length === 0) {
            forceNextTurnToGenerateText = true;
          }
        }

        functionResults.push({
          functionResponse: { name: call.name, response: { result: response } },
        });

        functionResponseSteps.push({
          type: "function_result",
          call_id: callId,
          name: call.name,
          result: [
            {
              type: "text",
              text: typeof response === "string" ? response : JSON.stringify(response),
            },
          ],
        });
      }

      history.push({ role: AiRole.FUNCTION as never, parts: functionResults as never[] });

      // Configurar el input para el siguiente turno de la Interactions API como el listado de steps de respuesta
      nextInteractionInput = functionResponseSteps;
    }

    } catch (e) {
      if (e instanceof AiProviderError && currentSessionId) {
        await this.aiSessionService.markSessionProviderError(currentSessionId, e.message);
      }
      throw e;
    }

    if (!finalText) {
      throw new AiError("El asistente no pudo generar una respuesta.");
    }

    const totalUsage = {
      promptTokens: classifyTokens.promptTokens + loopUsage.promptTokens,
      completionTokens: classifyTokens.completionTokens + loopUsage.completionTokens,
      totalTokens: classifyTokens.totalTokens + loopUsage.totalTokens,
      cachedTokens: loopUsage.cachedTokens,
    };

    const sessionUsage = await this.aiSessionService.saveChatRound(
      agentId,
      currentSessionId!,
      history,
      [
        { role: "user", content: message, promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        {
          role: "classify",
          content: null,
          promptTokens: classifyTokens.promptTokens,
          completionTokens: classifyTokens.completionTokens,
          totalTokens: classifyTokens.totalTokens,
        },
        {
          role: "model",
          content: finalText,
          promptTokens: loopUsage.promptTokens,
          completionTokens: loopUsage.completionTokens,
          totalTokens: loopUsage.totalTokens,
          interactionId: lastInteractionId,
        },
      ],
      totalUsage,
      lastInteractionId,
    );

    return { text: finalText, sessionId: currentSessionId!, usage: totalUsage, sessionUsage, metadata: skillMetadata };

  }

  async startPolicySession(
    sessionId: string,
    agentId: string,
    extraction: unknown,
    _documentMetadataId: string,
  ): Promise<ChatResponse> {
    const extractionSummary = JSON.stringify(extraction, null, 2);
    const initialMessage = `[SYSTEM_INGESTION] El sistema extrajo la siguiente información de la póliza:\n\`\`\`json\n${extractionSummary}\n\`\`\`\nPor favor presenta un resumen al asesor y solicita confirmación para crear la póliza.`;

    return await this.processMessage(initialMessage, agentId, sessionId);
  }

  async startPolicyUpdateSession(
    sessionId: string,
    agentId: string,
    extraction: unknown,
    existingPolicyId: string,
    diff: PolicyChange[],
  ): Promise<ChatResponse> {
    const policyNumber = (extraction as { policyNumber?: string }).policyNumber ?? 'N/A';
    const diffLines = diff.length > 0
      ? diff.map(c => `- ${c.label}: "${c.oldValue ?? '—'}" → "${c.newValue}"`).join('\n')
      : '(no field differences detected)';

    const initialMessage = [
      `[SYSTEM_INGESTION] Policy number "${policyNumber}" already exists in the advisor's portfolio (ID: ${existingPolicyId}).`,
      '',
      'Differences detected vs. existing data:',
      diffLines,
      '',
      'Inform the advisor about the duplicate and ask whether they want to UPDATE the existing policy with the new data, or DISCARD the new document.',
    ].join('\n');

    return await this.processMessage(initialMessage, agentId, sessionId);
  }
}
