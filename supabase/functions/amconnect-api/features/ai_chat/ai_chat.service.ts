import { zodToJsonSchema } from "zod-to-json-schema";
import { AiMessage, AiRole, IAiProvider } from "../../core/ai_provider.interface.ts";
import { AiSessionService } from "./ai_session.service.ts";
import { AiError, AiProviderError } from "../../shared/errors.ts";
import { getSkillByName, getSkillsByDomains } from "./skills/index.ts";
import { SkillContext } from "./skills/skill.core.ts";

const AVAILABLE_DOMAINS = ["contact", "policy", "reminder", "pending_task", "catalog", "knowledge"];
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
- The advisor manages policies ON BEHALF of their clients. When they say "my policies" or "my clients' policies", they mean the policies in their portfolio — use get_all_policies. Never ask if they mean personal policies.
- Detect the language of each message and respond in that same language.
- Respond naturally and professionally.
- STRICT KNOWLEDGE CONSTRAINT: You must ONLY answer questions using the information retrieved from your tools (structured data or search_knowledge RAG). You are strictly prohibited from using your pre-trained internet knowledge to answer questions about companies, products, addresses, locations, or definitions. 
- If the advisor asks about system metadata, configurations, or available options (such as available reminder types, policy statuses, currencies, branches, etc.), you MUST call the appropriate catalog or metadata retrieval tool (e.g., get_reminder_types) to retrieve the information from the database. Never invent lists of options or answer using your pre-trained knowledge.
- If a user asks a question that requires external information (e.g., "donde esta la torre reforma") and your search_knowledge tool or database query returns empty or doesn't contain the answer, you must state that you do not have that information in your knowledge base. Do NOT answer from your general knowledge.
- When the user asks about a person, search for them first with search_contact.
- Data hierarchy: ALWAYS try structured skills first (contacts, policies, reminders, catalog). Only use search_knowledge when the information is not available in structured data — for example, notes from meetings, ingested documents, audio transcripts, or WhatsApp conversations.
- When using search_knowledge, make ONE single call with a comprehensive query covering all aspects of the question. Never call search_knowledge multiple times for the same user message.
- If a search returns no results and the user wanted to take action, ask if they want to create it. If confirmed, use the data the user already provided — do NOT ask for it again.
- To count clients or records use the counting tools — do not fetch all data just to count.
- For questions about health conditions, notes or personal information, use search_contact_notes.
- When you need to create something, do it directly without asking for confirmation unless critical data is missing.
- NEVER invent or copy values between fields to satisfy required fields. If the user did not provide a contact's full name, ask for it — do not use CURP, RFC, email or any other field as a name.
- Save data EXACTLY as the user provided it — never interpret, translate or look up external information (e.g. if they say "zócalo", save "zócalo", do not look up the real address).
- If you cannot find information, say so clearly.
- When a tool returns multiple records, apply this rule strictly:
  - LIST or general query (e.g. "show me all my clients", "list all policies"): show all results, no clarification needed.
  - SPECIFIC entity query (user mentions a name, partial name, or any identifier — e.g. "tell me about Julio", "what does Mariana's policy cover", "when does Juan's renewal expire"): if the search returns MORE THAN ONE match, STOP immediately. Do NOT call any more tools to fetch details of each match. Use save_pending_task to save what you already know, then list the matches briefly and ask the user which one they mean.
  - SINGLE match for a specific query: proceed directly with that record.
- When the user clarifies which record they mean → use resolve_pending_task, then continue with the correct record.
`.trim();

export interface ChatResponse {
  text: string;
  sessionId: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number };
  metadata?: Record<string, unknown>;
}

export class AiChatService {
  constructor(
    private aiProvider: IAiProvider,
    private skillContext: Omit<SkillContext, "agentId" | "sessionId" | "aiSessionService">,
    private aiSessionService: AiSessionService,
  ) {}

  async cancelSession(sessionId: string): Promise<{ cancelledTasks: number }> {
    return await this.aiSessionService.cancelSession(sessionId);
  }

  async processMessage(
    message: string,
    agentId: string,
    sessionId?: string | null,
    timezone?: string,
  ): Promise<ChatResponse> {
    const history: AiMessage[] = [];
    debugger;
    const sId = sessionId ?? undefined;
    let currentSessionId = sId;

    // Cargar historial si hay sesión
    let sessionType = "chat";

    if (sId) {
      const session = await this.aiSessionService.getSessionContext(sId);
      if (session?.history) history.push(...(session.history as AiMessage[]));
      sessionType = session?.type ?? "chat";
    } else {
      // Crear nueva sesión
      currentSessionId = await this.aiSessionService.createSession(agentId, {
        triggerMessage: message,
        sessionType: "chat",
        modelName: this.aiProvider.model,
      });
    }

    history.push({ role: AiRole.USER, parts: [{ text: message }] });

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

    // Calcular fecha y hora local con zona horaria del servidor/asesor
    const now = new Date();
    let localIso = "";
    let offsetStr = "";

    try {
      const tz = timezone || "America/Mexico_City";
      const formatter = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        year: "numeric",
        month: "2-digit",
        day: "2-digit",
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      });
      const parts = formatter.formatToParts(now);
      const partVal = (type: string) => parts.find((p) => p.type === type)!.value;
      
      const year = partVal("year");
      const month = partVal("month");
      const day = partVal("day");
      const hour = partVal("hour");
      const minute = partVal("minute");
      const second = partVal("second");

      const tzFormatter = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        timeZoneName: "longOffset",
      });
      const tzParts = tzFormatter.formatToParts(now);
      const tzNamePart = tzParts.find((p) => p.type === "timeZoneName")?.value || "";
      
      if (tzNamePart === "GMT" || tzNamePart === "UTC") {
        offsetStr = "+00:00";
      } else {
        const match = tzNamePart.match(/GMT([+-])(\d{1,2}):?(\d{2})?/);
        if (match) {
          const sign = match[1];
          const hours = match[2].padStart(2, "0");
          const minutes = (match[3] || "00").padStart(2, "0");
          offsetStr = `${sign}${hours}:${minutes}`;
        } else {
          offsetStr = "+00:00";
        }
      }
      localIso = `${year}-${month}-${day}T${hour}:${minute}:${second}${offsetStr}`;
    } catch (_e) {
      const offsetMin = -now.getTimezoneOffset();
      const sign = offsetMin >= 0 ? "+" : "-";
      const pad = (n: number) => String(Math.abs(n)).padStart(2, "0");
      offsetStr = `${sign}${pad(Math.floor(offsetMin / 60))}:${pad(offsetMin % 60)}`;
      localIso = new Date(now.getTime() + (offsetMin * 60 * 1000)).toISOString().slice(0, 19) + offsetStr;
    }

    // Construir system prompt con contexto de pending tasks si los hay
    let systemPrompt = isPolicyIngestion ? POLICY_INGESTION_PROMPT : SYSTEM_PROMPT;
    systemPrompt += `\n\nAdvisor's Current Local Date and Time (with timezone offset): ${localIso}\nIMPORTANT: When creating or updating reminders, always resolve date/time expressions (e.g. "mañana", "el martes a las 3 de la tarde") using this current local date, and format the output "due_date" as an ISO 8601 string including this exact timezone offset (e.g., "YYYY-MM-DDTHH:mm:ss${offsetStr}").`;

    if (pendingTasks.length > 0) {
      const tasksContext = pendingTasks
        .map((t) => `- ID: ${t.id}, tipo: ${t.taskType}, datos: ${JSON.stringify(t.payload)}`)
        .join("\n");
      systemPrompt += `\n\nTareas pendientes en esta sesión que esperan resolución:\n${tasksContext}`;
    }

    const ctx: SkillContext = {
      agentId,
      sessionId: currentSessionId!,
      aiSessionService: this.aiSessionService,
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
    let forceNextTurnToGenerateText = false;
    let skillMetadata: Record<string, unknown> | undefined;

    try {
    while (loops < MAX_LOOPS) {
      loops++;
      const currentTools = forceNextTurnToGenerateText ? [] : tools;
      const result = await this.aiProvider.processUserRequest(history, currentTools, systemPrompt);

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
              .map((i: { path: (string | number)[]; message: string }) => `${i.path.join(".") || "campo"}: ${i.message}`)
              .join("; ");
            response = { error: `Faltan datos requeridos — ${missing}. Pídelos al usuario antes de volver a llamar este skill.` };
          } else {
            try {
              const rawResponse = await skill.execute(validation.data, ctx);
              // Interceptar __skillMetadata sin enviarlo al modelo
              if (
                rawResponse &&
                typeof rawResponse === "object" &&
                "__skillMetadata" in (rawResponse as Record<string, unknown>)
              ) {
                const { __skillMetadata, ...rest } = rawResponse as Record<string, unknown>;
                skillMetadata = __skillMetadata as Record<string, unknown>;
                response = rest;
              } else {
                response = rawResponse;
              }
            } catch (e) {
              const msg = e instanceof Error ? e.message : "Error ejecutando la herramienta.";
              console.error(`[CHAT] skill=${call.name} threw: ${msg}`);
              response = { error: msg };
            }
          }
        } else {
          response = { error: `Herramienta desconocida: ${call.name}` };
        }

        // Si la base de conocimiento o notas de contacto devuelven vacío, forzamos que en el siguiente turno genere texto directo
        if (call.name === "search_knowledge" || call.name === "search_contact_notes") {
          if (Array.isArray(response) && response.length === 0) {
            forceNextTurnToGenerateText = true;
          }
        }

        functionResults.push({
          functionResponse: { name: call.name, response: { result: response } },
        });
      }

      history.push({ role: AiRole.FUNCTION as never, parts: functionResults as never[] });
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
    };

    await this.aiSessionService.saveChatRound(
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
        },
      ],
      totalUsage,
    );

    return { text: finalText, sessionId: currentSessionId!, usage: totalUsage, metadata: skillMetadata };
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
}
