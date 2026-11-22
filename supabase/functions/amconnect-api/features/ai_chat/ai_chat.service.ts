import { AiMessage, AiRole, IAiProvider } from "../../core/ai_provider.interface.ts";
import { AiSessionService } from "./ai_session.service.ts";
import { AiProviderError } from "../../shared/errors.ts";
import { buildToolDeclarations, offeredToolNames } from "../../shared/tool_declarations.ts";
import { executeSkill } from "./skills/skill_executor.ts";
import { SkillContext, SkillServices } from "./skills/skill.core.ts";
import { buildLocalDateTime, DEFAULT_TIMEZONE } from "../../shared/datetime.ts";
import { PromptService } from "../../modules/prompt/prompt.service.ts";
import type { PolicyChange } from "../document_processing/policy_diff.ts";
import { AiChatContext } from "./ai.dto.ts";
import { languageName } from "../../shared/locale.ts";
import {
  AVAILABLE_DOMAINS,
  buildContextPrefix,
  collectAdvisorWords,
  lastReplyLanguage,
  POLICY_INGESTION_DOMAINS,
  resolveChatDomains,
} from "./chat_turn.ts";
import { extractCitations, RagAttachmentCollector } from "./rag_attachments.ts";
import { TOOL_SELECTION_MODE, type ToolSelectionMode } from "../../shared/assistant.config.ts";
import { detectReplyLanguage, type ReplyLanguage } from "./reply_language.ts";

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
    private skillContext: SkillServices,
    private aiSessionService: AiSessionService,
    private promptService: PromptService,
    // Inyectable para pruebas; en producción es el valor de shared/assistant.config.ts.
    private toolSelectionMode: ToolSelectionMode = TOOL_SELECTION_MODE,
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
    newSessionType: "chat" = "chat",
    advisorLocale?: string,
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
    let detectedLanguage: string | undefined;
    // Solo el modo "all" detecta el idioma localmente; se resuelve más abajo
    // porque su fallback depende del historial.
    const useAllTools = !isPolicyIngestion && this.toolSelectionMode === "all";

    if (isPolicyIngestion) {
      activeDomains = POLICY_INGESTION_DOMAINS;
    } else if (useAllTools) {
      // Todas las herramientas de chat, en el orden del registro de skills
      // (estable entre turnos y asesores). Sin clasificador.
      activeDomains = AVAILABLE_DOMAINS;
    } else {
      // TODO: Previously 'catalog' was always active. Kept as dynamic load to save tokens.
      const { domains, usage, language } = await this.aiProvider.classifyMessage(message, AVAILABLE_DOMAINS);
      classifyUsage = usage;
      detectedLanguage = language;
      activeDomains = resolveChatDomains(domains, context);
    }

    // Sin tareas pendientes, `resolve_pending_task` ni siquiera se ofrece.
    //
    // No es optimización: es quitarle al modelo una salida falsa. Cuando hay
    // que desambiguar un cliente, en el turno de la aclaración ("el segundo")
    // el modelo llama a resolve_pending_task —con un id inventado, porque no
    // guardó ninguna— la da por buena y le confirma al asesor un compromiso
    // que nunca creó. Pedírselo por prompt no bastó: se probó dos veces el
    // 2026-08-28 y en la segunda cambió una mentira por otra ("lo registré en
    // las notas", sin llamar a nada). Si la herramienta no existe en el turno,
    // no hay a dónde escaparse: tiene que llamar a la que de verdad escribe.
    const tools = [{
      functionDeclarations: buildToolDeclarations(activeDomains, {
        exclude: pendingTasks.length === 0 ? ["resolve_pending_task"] : [],
      }),
    }];
    const offeredTools = offeredToolNames(tools[0].functionDeclarations);

    // Fecha y hora local del asesor — implementación compartida con voz
    const { localIso, offsetStr } = buildLocalDateTime(timezone || DEFAULT_TIMEZONE);

    // System instruction ESTÁTICO: ya no le queda ni una sustitución. Hasta el
    // 2026-09-14 traía {{advisor_language}}, que partía el prefijo en uno por
    // idioma; ahora el idioma viaja como dato del turno (abajo) y el texto es
    // idéntico para todos los asesores, así que el implicit caching de Gemini
    // lo comparte entre todos (medido el 2026-09-07 con el prefijo por asesor:
    // 12,078 tokens cacheados de 13,270 en el tercer turno).
    //
    // Nada se sustituye aquí: lo que cambia por request —fecha, idioma, pending
    // tasks, pantalla activa— va en el mensaje del usuario, abajo.
    const dbPromptCode = isPolicyIngestion ? "policy_ingestion_system" : "ai_chat_system";
    const systemInstruction = await this.promptService.getPrompt(dbPromptCode, {});

    // Contexto dinámico (fecha/hora, pending tasks) va en el mensaje del usuario,
    // no en systemInstruction, para no romper el caching del prefix estático.
    // El idioma en que se contesta va como DATO del turno, no como regla del
    // prompt. Pedirle al modelo que lo detectara no bastaba: con la app en
    // inglés y la conversación abierta en inglés, un mensaje en español se
    // contestaba en inglés 13 de 24 veces (medido el 2026-09-14). Escrito aquí,
    // 0 de 24.
    //
    // Tres fuentes, en este orden:
    //   1. Lo que detectó el clasificador para ESTE mensaje.
    //   2. El último idioma que se usó en la conversación. Vive en el propio
    //      historial: este mismo bloque [CONTEXT] se guarda con cada turno del
    //      asesor, así que releerlo no cuesta ni una consulta. Es lo que salva
    //      los turnos sin idioma propio —"ok", "el segundo", un nombre— que de
    //      otro modo caerían al idioma de la app y romperían una conversación
    //      que iba en el otro.
    //   3. El idioma que el asesor configuró en la app, para el primer turno.
    let langSource: "detected" | "fallback" = detectedLanguage ? "detected" : "fallback";
    const fallbackLanguage = lastReplyLanguage(history) ?? languageName(advisorLocale);
    let replyLanguage = detectedLanguage ?? fallbackLanguage;
    if (useAllTools) {
      const d = detectReplyLanguage(message, fallbackLanguage === "English" ? "English" : "Spanish" as ReplyLanguage);
      replyLanguage = d.language;
      langSource = d.source;
    }
    if (!isPolicyIngestion) {
      console.warn(
        `[TOOLS] mode=${this.toolSelectionMode} count=${tools[0].functionDeclarations.length} lang=${replyLanguage} langSource=${langSource}`,
      );
    }
    const contextPrefix = buildContextPrefix({ localIso, offsetStr, replyLanguage, pendingTasks, context });

    history.push({ role: AiRole.USER, parts: [{ text: contextPrefix + message }] });

    const ctx: SkillContext = {
      agentId,
      sessionId: currentSessionId!,
      aiSessionService: this.aiSessionService,
      ...this.skillContext,
      timezone: timezone || "America/Mexico_City",
      timezoneOffset: offsetStr || "-06:00",
      advisorWords: collectAdvisorWords(history),
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

    // Adjuntos recolectados de los hits de RAG durante el bucle.
    const ragAttachments = new RagAttachmentCollector();
    // Notas citadas explícitamente por el modelo en su respuesta final (ver CITE_MARKER_RE).
    let citedNoteIds = new Set<string>();

    try {
    while (loops < MAX_LOOPS) {
      loops++;
      // Siempre mandamos `tools` completo (aunque forceNextTurnToGenerateText esté activo)
      // para no cambiar el prefix system_instruction+tools entre turnos y no perder el
      // implicit caching de Gemini — el bloqueo de function calls se hace vía forceTextOnly.
      const result = await this.aiProvider.processInteraction(
        nextInteractionInput,
        tools,
        systemInstruction,
        lastInteractionId,
        history,
        forceNextTurnToGenerateText,
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
        const { displayText, citedNoteIds: cited } = extractCitations(result.text);
        finalText = displayText;
        citedNoteIds = cited;
        history.push({ role: AiRole.MODEL, parts: [{ text: displayText }] });
        break;
      }

      // Respuesta vacia: ni texto ni herramientas. Se sale del bucle en vez de
      // tronar, por lo mismo que el agotamiento de turnos — abajo hay un intento
      // de cierre y, si tampoco sale, un mensaje honesto. Un 502 aqui le diria
      // al asesor que no paso nada cuando puede que ya se haya escrito.
      if (!result.functionCalls?.length) {
        console.warn("[AiChat] El modelo no devolvió texto ni function calls");
        break;
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

        const execution = await executeSkill(call.name, call.args, ctx, offeredTools);
        if (execution.metadata) skillMetadata = execution.metadata;
        const response = execution.response;

        // Si la base de conocimiento o notas de contacto/póliza devuelven vacío,
        // forzamos que en el siguiente turno genere texto directo.
        if (ragAttachments.harvest(call.name, response).emptyRagSearch) {
          forceNextTurnToGenerateText = true;
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

      history.push({ role: AiRole.USER, parts: functionResults as never[] });

      // Configurar el input para el siguiente turno de la Interactions API como el listado de steps de respuesta
      nextInteractionInput = functionResponseSteps;
    }

    // Se acabaron los turnos y el modelo sigue pidiendo herramientas.
    //
    // Antes esto tronaba con AiError y el asesor veía un error genérico —
    // después de que el asistente YA hizo el trabajo: creó el compromiso, buscó
    // al cliente, lo que fuera. Todo eso quedó escrito en la base y él se quedó
    // creyendo que nada pasó, porque lo único que vio fue el error.
    //
    // Un turno más con las function calls bloqueadas: el modelo tiene el
    // historial completo con lo que ya ejecutó, así que puede contarlo. Se
    // mandan `tools` igual —sin cambiar el prefijo no se pierde el caching— y
    // el bloqueo va por forceTextOnly, el mismo camino que ya usa el RAG vacío.
    if (!finalText) {
      console.warn(`[AiChat] MAX_LOOPS (${MAX_LOOPS}) agotado — turno final sin herramientas`);

      const cierre = await this.aiProvider.processInteraction(
        nextInteractionInput,
        tools,
        systemInstruction,
        lastInteractionId,
        history,
        true,
      );

      if (cierre.usage) {
        loopUsage.promptTokens += cierre.usage.promptTokens;
        loopUsage.completionTokens += cierre.usage.completionTokens;
        loopUsage.totalTokens += cierre.usage.totalTokens;
        loopUsage.cachedTokens += cierre.usage.cachedTokens ?? 0;
      }

      if (cierre.text) {
        const { displayText, citedNoteIds: cited } = extractCitations(cierre.text);
        finalText = displayText;
        citedNoteIds = cited;
        history.push({ role: AiRole.MODEL, parts: [{ text: displayText }] });
      }
    }

    } catch (e) {
      if (e instanceof AiProviderError && currentSessionId) {
        await this.aiSessionService.markSessionProviderError(currentSessionId, e.message);
      }
      throw e;
    }

    // Ultimo recurso: ni siquiera el turno de cierre produjo texto.
    //
    // Sigue sin ser un 502. Para cuando llegamos aqui el asistente pudo haber
    // escrito de verdad —un compromiso, un recordatorio, una nota— y un error
    // le diria al asesor lo contrario. Se contesta con la verdad: no se pudo
    // resumir, revisa. Sin inventar que se hizo algo ni jurar que no se hizo
    // nada, porque desde aqui no se sabe cual de las dos.
    if (!finalText) {
      console.warn("[AiChat] El turno de cierre tampoco devolvió texto");
      finalText = "Me quedé sin poder resumirte lo que hice. Puede que sí haya " +
        "quedado registrado — revisa tu agenda o vuelve a pedírmelo para confirmar.";
      history.push({ role: AiRole.MODEL, parts: [{ text: finalText }] });
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
          cachedTokens: loopUsage.cachedTokens,
          interactionId: lastInteractionId,
        },
      ],
      totalUsage,
      lastInteractionId,
    );

    // attachment_list se alimenta de dos fuentes complementarias: los hits de
    // RAG con documento adjunto (búsqueda vectorial) y las notas del contexto de
    // pantalla. Solo se emite si ninguna skill ya produjo su propio metadata.
    if (!skillMetadata) {
      skillMetadata = ragAttachments.buildAttachmentList(citedNoteIds, context);
    }

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
