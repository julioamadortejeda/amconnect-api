import { AiMessage, AiRole, IAiProvider } from "../../core/ai_provider.interface.ts";
import { AiSessionService } from "./ai_session.service.ts";
import { AiProviderError } from "../../shared/errors.ts";
import { buildToolDeclarations } from "../../shared/tool_declarations.ts";
import { executeSkill } from "./skills/skill_executor.ts";
import { SkillContext } from "./skills/skill.core.ts";
import { buildLocalDateTime, DEFAULT_TIMEZONE } from "../../shared/datetime.ts";
import { PromptService } from "../../modules/prompt/prompt.service.ts";
import type { PolicyChange } from "../document_processing/policy_diff.ts";
import { AiChatContext } from "./ai.dto.ts";

const AVAILABLE_DOMAINS = ["contact", "policy", "reminder", "commitment", "pending_task", "catalog", "knowledge"];
const POLICY_INGESTION_DOMAINS = ["policy_ingestion"];
const MAX_LOOPS = 6;

// Skills de búsqueda vectorial que devuelven NoteMatch[]: sus resultados pueden
// traer documentos adjuntos que alimentan el attachment_list (botón "abrir
// archivo") aunque la nota se haya encontrado por similitud y no por pantalla.
const RAG_SEARCH_SKILLS = ["search_knowledge", "search_contact_notes", "search_policy_notes", "search_reminder_notes"];

// Margen de relevancia para adjuntos: dentro de una misma búsqueda, solo se
// adjuntan resultados cuya similitud esté a lo sumo esta distancia por debajo
// del mejor match. Evita adjuntar documentos que apenas cruzaron el threshold
// absoluto pero no tienen relación real con la pregunta (ej. una póliza de
// otro ramo apareciendo junto al documento realmente citado en la respuesta),
// mientras conserva múltiples adjuntos cuando genuinamente son parecidos entre
// sí (ej. varios documentos de un mismo cliente en una pregunta de resumen).
const ATTACHMENT_RELEVANCE_GAP = 0.15;

// Marcador inline que el modelo agrega junto a cada hecho tomado de una nota
// RAG ([[cite:noteId]], instrucción en RAG SOURCE CITATION RULE del prompt).
// Es el filtro AUTORITATIVO de qué adjuntar — el score de similitud (threshold
// + ATTACHMENT_RELEVANCE_GAP) no discrimina bien para queries cortas/genéricas
// (ver historial en RULES.md §5); lo que el modelo realmente citó en su texto
// sí es confiable. Se extrae y se limpia del texto antes de guardarlo/mostrarlo.
const CITE_MARKER_RE = /\s?\[\[cite:([0-9a-fA-F-]{36})\]\]/g;

function extractCitations(text: string): { displayText: string; citedNoteIds: Set<string> } {
  const citedNoteIds = new Set<string>();
  const displayText = text
    .replace(CITE_MARKER_RE, (_match, id: string) => {
      citedNoteIds.add(id);
      return "";
    })
    .replace(/[ \t]+\n/g, "\n")
    .trim();
  return { displayText, citedNoteIds };
}

export interface ChatResponse {
  text: string;
  sessionId: string;
  usage: { promptTokens: number; completionTokens: number; totalTokens: number; cachedTokens?: number };
  sessionUsage?: { promptTokens: number; completionTokens: number; totalTokens: number };
  metadata?: Record<string, unknown>;
}

/** El bloque [CONTEXT] que se antepone al mensaje: va hasta el primer renglón en blanco. */
const CONTEXT_PREFIX_RE = /^\[CONTEXT\][\s\S]*?\n\n/;

/**
 * Junta lo que el asesor ha ESCRITO en la conversación, para las skills que
 * verifican citas (ver `SkillContext.advisorWords`).
 *
 * Descarta los turnos del modelo y los resultados de funciones —que también
 * viajan con rol USER pero no traen texto— y le quita a cada mensaje el bloque
 * [CONTEXT] que le antepone este servicio: son fechas y datos de pantalla que
 * el asesor nunca tecleó, y dejarlos ahí permitiría validar una cita contra
 * algo que él no dijo.
 */
function collectAdvisorWords(history: AiMessage[]): string {
  return history
    .filter((m) => m.role === AiRole.USER)
    .flatMap((m) => (m.parts ?? []) as { text?: unknown }[])
    .map((p) => p.text)
    .filter((t): t is string => typeof t === "string")
    .map((t) => t.replace(CONTEXT_PREFIX_RE, ""))
    .join("\n");
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
    newSessionType: "chat" = "chat",
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

      // "¿Qué tengo que hacer en septiembre?" es una sola pregunta para el
      // asesor, pero sus pendientes viven en DOS lados: los recordatorios que
      // él creó y los compromisos que la IA sacó de sus notas. El clasificador
      // lee eso como agenda y devuelve solo "reminder" — y la respuesta sale
      // incompleta sin que nadie se entere. Van juntos siempre.
      if (parsedDomains.includes("reminder") && !parsedDomains.includes("commitment")) {
        parsedDomains.push("commitment");
      }
      if (parsedDomains.includes("commitment") && !parsedDomains.includes("reminder")) {
        parsedDomains.push("reminder");
      }
      
      activeDomains = [...new Set([...ALWAYS_ACTIVE, ...parsedDomains])];
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

    // Adjuntos recolectados de los hits de RAG durante el bucle (dedupe por
    // nota — puede haber varios chunks de la misma nota en un mismo resultado).
    const ragAttachments: Record<string, unknown>[] = [];
    const ragHarvestSeenIds = new Set<string>();
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

        const execution = await executeSkill(call.name, call.args, ctx);
        if (execution.metadata) skillMetadata = execution.metadata;
        const response = execution.response;

        // Si la base de conocimiento o notas de contacto/póliza devuelven vacío, forzamos que en el siguiente turno genere texto directo
        if (RAG_SEARCH_SKILLS.includes(call.name) && Array.isArray(response)) {
          if (response.length === 0) {
            forceNextTurnToGenerateText = true;
          }
          // Cosechar adjuntos de las notas encontradas por similitud, filtrando
          // por relevancia relativa al mejor match de esta búsqueda (ver
          // ATTACHMENT_RELEVANCE_GAP).
          const hits = response as Record<string, unknown>[];
          const similarities = hits
            .map((h) => h.similarity as number | undefined)
            .filter((s): s is number => typeof s === "number");
          const maxSimilarity = similarities.length > 0 ? Math.max(...similarities) : undefined;

          for (const hit of hits) {
            const storagePath = (hit.storagePath ?? hit.storage_path) as string | undefined;
            const id = (hit.noteId ?? hit.note_id ?? hit.id) as string | undefined;
            const similarity = hit.similarity as number | undefined;
            const isRelevantEnough = maxSimilarity === undefined || similarity === undefined ||
              similarity >= maxSimilarity - ATTACHMENT_RELEVANCE_GAP;
            if (storagePath && id && isRelevantEnough && !ragHarvestSeenIds.has(id)) {
              ragHarvestSeenIds.add(id);
              ragAttachments.push({
                id,
                fileName: hit.fileName ?? hit.file_name ?? hit.summary ?? "Documento",
                storagePath,
                sourceType: hit.sourceType ?? hit.source_type ?? "document",
                summary: hit.summary ?? hit.content,
              });
            }
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
      // Filtro autoritativo: solo adjuntar notas RAG que el modelo citó en su
      // respuesta. Si no citó ninguna (respuesta sin RAG, o no cumplió la
      // instrucción esta vez), se conserva el set ya filtrado por relevancia
      // relativa como resguardo — mejor eso que ocultar adjuntos de golpe.
      const citedRagAttachments = citedNoteIds.size > 0
        ? ragAttachments.filter((a) => citedNoteIds.has(a.id as string))
        : ragAttachments;

      const attachments: Record<string, unknown>[] = [...citedRagAttachments];
      const seenAttachmentIds = new Set(attachments.map((a) => a.id as string));

      if (context?.data?.notes && Array.isArray(context.data.notes)) {
        // deno-lint-ignore no-explicit-any
        const contextAttachments = (context.data.notes as any[])
          .filter((n: any) => n.storage_path || n.storagePath || n.fileName || n.file_name)
          .map((n: any) => ({
            id: n.id,
            fileName: n.fileName || n.file_name || n.summary || "Documento",
            storagePath: n.storagePath || n.storage_path,
            sourceType: n.sourceType || n.source_type || "document",
            summary: n.summary || n.content,
          }));
        for (const att of contextAttachments) {
          if (att.id && seenAttachmentIds.has(att.id as string)) continue;
          if (att.id) seenAttachmentIds.add(att.id as string);
          attachments.push(att);
        }
      }

      if (attachments.length > 0) {
        skillMetadata = {
          type: "attachment_list",
          attachments,
        };
      }
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
