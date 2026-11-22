// Ciclo modelo ↔ herramientas de un turno del chat de texto (Fase 2, paso 2).
//
// Llama al modelo, ejecuta las herramientas que pide (solo las ofrecidas, bug
// #7), repite hasta tener texto o agotar MAX_LOOPS y, si no hubo texto, hace
// una pasada de cierre sin herramientas. Emite eventos (agent_events.ts) en
// cada paso. No sabe de HTTP, de sesiones ni de cobro: eso es de quien lo usa.
import { AiRole, type AiFunctionCall, type AiGenerationResult, type AiMessage, type IAiProvider } from "../../core/ai_provider.interface.ts";
import { executeSkill as defaultExecuteSkill, type SkillExecutionResult } from "./skills/skill_executor.ts";
import type { SkillContext } from "./skills/skill.core.ts";
import { extractCitations, RagAttachmentCollector } from "./rag_attachments.ts";
import { addUsage, emptyUsage } from "./token_usage.ts";
import type { UsageTokens } from "./ai_session.service.ts";
import {
  type AgentEvent,
  type AgentEventListener,
  type AgentLoopResult,
  type ExhaustedReason,
  toolLabel,
} from "./agent_events.ts";

export const MAX_LOOPS = 6;

/** Texto cuando ni la pasada de cierre produjo texto. */
export const EXHAUSTED_FALLBACK_TEXT = "Me quedé sin poder resumirte lo que hice. Puede que sí haya " +
  "quedado registrado — revisa tu agenda o vuelve a pedírmelo para confirmar.";

/** Resultado que va al modelo por una herramienta que no se ejecutó por cancelación. */
const CANCELLED_TOOL_RESULT = { ok: false, error: "Not executed: the turn was cancelled." };

export type SkillRunner = (
  name: string,
  args: unknown,
  ctx: SkillContext,
  offered?: ReadonlySet<string>,
) => Promise<SkillExecutionResult>;

export interface AgentLoopInput {
  /** Primer input del turno: [CONTEXT] + mensaje del asesor. */
  input: string;
  /** Historial con el mensaje del turno ya agregado. El loop lo MUTA. */
  history: AiMessage[];
  tools: Record<string, unknown>[];
  /** Lista blanca de herramientas ofrecidas este turno (bug #7). */
  offeredNames: ReadonlySet<string>;
  systemInstruction: string;
  ctx: SkillContext;
  lastInteractionId?: string;
  /** Idioma del turno ("Spanish"/"English"), para las etiquetas de herramientas. */
  replyLanguage: string;
  onEvent?: AgentEventListener;
  /** Cancelación (§7.3): se revisa antes de cada llamada al modelo y de cada herramienta. */
  signal?: AbortSignal;
  isCancelled?: () => boolean;
}

export interface AgentLoopOutcome extends AgentLoopResult {
  /** true si se detuvo por cancelación: no hubo pasada de cierre ni texto de respaldo. */
  cancelled: boolean;
}

export interface AgentLoopOptions {
  maxLoops?: number;
  /** Inyectable para pruebas; en producción, executeSkill. */
  runSkill?: SkillRunner;
}

/** Estado mutable de un turno. */
interface TurnState {
  p: AgentLoopInput;
  usage: UsageTokens;
  ragAttachments: RagAttachmentCollector;
  citedNoteIds: Set<string>;
  skillMetadata: Record<string, unknown> | undefined;
  lastInteractionId: string | undefined;
  nextInput: string | Record<string, unknown>[];
  forceTextOnly: boolean;
  finalText: string;
  modelCalls: number;
  cancelled: boolean;
}

type ModelResult = AiGenerationResult & { interactionId?: string };

export class AgentLoop {
  private readonly maxLoops: number;
  private readonly runSkill: SkillRunner;

  constructor(private provider: IAiProvider, opts: AgentLoopOptions = {}) {
    this.maxLoops = opts.maxLoops ?? MAX_LOOPS;
    this.runSkill = opts.runSkill ?? defaultExecuteSkill;
  }

  async run(p: AgentLoopInput): Promise<AgentLoopOutcome> {
    const s = this.initialState(p);
    const reason = await this.runToolLoop(s);
    if (!s.cancelled && !s.finalText) await this.closingTurn(s, reason);
    if (s.cancelled) return await this.finishCancelled(s);
    if (!s.finalText) await this.applyFallback(s);
    return await this.finishDone(s);
  }

  private initialState(p: AgentLoopInput): TurnState {
    return {
      p,
      usage: emptyUsage(),
      ragAttachments: new RagAttachmentCollector(),
      // Notas citadas explícitamente por el modelo en su respuesta final (ver CITE_MARKER_RE).
      citedNoteIds: new Set<string>(),
      skillMetadata: undefined,
      lastInteractionId: p.lastInteractionId,
      nextInput: p.input,
      forceTextOnly: false,
      finalText: "",
      modelCalls: 0,
      cancelled: false,
    };
  }

  /** Vueltas modelo → herramientas. Devuelve por qué terminó sin texto (si fue así). */
  private async runToolLoop(s: TurnState): Promise<ExhaustedReason> {
    for (let loops = 0; loops < this.maxLoops; loops++) {
      if (this.checkCancelled(s)) return "max_loops";
      const result = await this.callModel(s, s.forceTextOnly);

      if (result.text && !result.functionCalls?.length) {
        await this.acceptText(s, result.text);
        // Solo importa si el texto quedó vacío (traía únicamente citas).
        return "empty_response";
      }
      // Respuesta vacia: ni texto ni herramientas. Se sale del bucle en vez de
      // tronar, por lo mismo que el agotamiento de turnos — abajo hay un intento
      // de cierre y, si tampoco sale, un mensaje honesto. Un 502 aqui le diria
      // al asesor que no paso nada cuando puede que ya se haya escrito.
      if (!result.functionCalls?.length) {
        console.warn("[AiChat] El modelo no devolvió texto ni function calls");
        return "empty_response";
      }
      await this.runToolCalls(s, result);
      if (s.cancelled) return "max_loops";
    }
    return "max_loops";
  }

  /**
   * Una llamada al modelo. Siempre se manda `tools` completo (aunque se fuerce
   * texto) para no cambiar el prefix system_instruction+tools entre turnos y no
   * perder el implicit caching de Gemini — el bloqueo va por forceTextOnly.
   */
  private async callModel(s: TurnState, forceTextOnly: boolean): Promise<ModelResult> {
    s.modelCalls++;
    await this.emit(s, { type: "model_call_started", call: s.modelCalls, forceTextOnly });
    const result = await this.provider.processInteraction(
      s.nextInput,
      s.p.tools,
      s.p.systemInstruction,
      s.lastInteractionId,
      s.p.history,
      forceTextOnly,
    );
    if (result.interactionId) s.lastInteractionId = result.interactionId;
    addUsage(s.usage, result.usage);
    return result;
  }

  /** Texto del modelo: se limpian las citas y se agrega al historial. */
  private async acceptText(s: TurnState, rawText: string): Promise<void> {
    const { displayText, citedNoteIds } = extractCitations(rawText);
    s.finalText = displayText;
    s.citedNoteIds = citedNoteIds;
    s.p.history.push({ role: AiRole.MODEL, parts: [{ text: displayText }] });
    if (displayText) await this.emit(s, { type: "text", text: displayText });
  }

  /** Ejecuta las function calls de una vuelta y prepara el input de la siguiente. */
  private async runToolCalls(s: TurnState, result: ModelResult): Promise<void> {
    const functionResults: Record<string, unknown>[] = [];
    const functionResponseSteps: Record<string, unknown>[] = [];
    s.p.history.push({ role: AiRole.MODEL, parts: result.rawModelParts as never[] });

    for (const call of result.functionCalls ?? []) {
      const response = this.checkCancelled(s) ? CANCELLED_TOOL_RESULT : await this.runTool(s, call);
      functionResults.push({ functionResponse: { name: call.name, response: { result: response } } });
      functionResponseSteps.push(this.functionResultStep(call, result.rawModelParts, response));
    }

    s.p.history.push({ role: AiRole.USER, parts: functionResults as never[] });
    // Input del siguiente turno de la Interactions API: los steps de respuesta.
    s.nextInput = functionResponseSteps;
  }

  /** Una herramienta: lista blanca + ejecución, adjuntos RAG y eventos. */
  private async runTool(s: TurnState, call: AiFunctionCall): Promise<unknown> {
    const label = toolLabel(call.name, s.p.replyLanguage);
    await this.emit(s, { type: "tool_started", name: call.name, label });
    const execution = await this.runSkill(call.name, call.args, s.p.ctx, s.p.offeredNames);
    if (execution.metadata) s.skillMetadata = execution.metadata;
    const response = execution.response;
    // Si la base de conocimiento o notas de contacto/póliza devuelven vacío,
    // forzamos que en el siguiente turno genere texto directo.
    if (s.ragAttachments.harvest(call.name, response).emptyRagSearch) s.forceTextOnly = true;
    await this.emit(s, { type: "tool_finished", name: call.name, label, ok: isOkResponse(response) });
    return response;
  }

  /** Step `function_result` para la Interactions API, con el id de la llamada original. */
  private functionResultStep(
    call: AiFunctionCall,
    rawModelParts: unknown[] | undefined,
    response: unknown,
  ): Record<string, unknown> {
    const originalStep = rawModelParts?.find(
      // deno-lint-ignore no-explicit-any
      (part: any) => part.functionCall && part.functionCall.name === call.name,
    );
    // deno-lint-ignore no-explicit-any
    const callId = (originalStep as any)?.functionCall?.id || `call_${Math.random().toString(36).substring(7)}`;
    return {
      type: "function_result",
      call_id: callId,
      name: call.name,
      result: [{ type: "text", text: typeof response === "string" ? response : JSON.stringify(response) }],
    };
  }

  // Se acabaron los turnos (o el modelo no devolvió nada) y no hay texto.
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
  private async closingTurn(s: TurnState, reason: ExhaustedReason): Promise<void> {
    console.warn(`[AiChat] MAX_LOOPS (${this.maxLoops}) agotado — turno final sin herramientas`);
    if (this.checkCancelled(s)) return;
    await this.emit(s, { type: "exhausted", reason, maxLoops: this.maxLoops });
    const result = await this.callModel(s, true);
    if (result.text) await this.acceptText(s, result.text);
  }

  // Ultimo recurso: ni siquiera el turno de cierre produjo texto.
  //
  // Sigue sin ser un 502. Para cuando llegamos aqui el asistente pudo haber
  // escrito de verdad —un compromiso, un recordatorio, una nota— y un error
  // le diria al asesor lo contrario. Se contesta con la verdad: no se pudo
  // resumir, revisa. Sin inventar que se hizo algo ni jurar que no se hizo
  // nada, porque desde aqui no se sabe cual de las dos.
  private async applyFallback(s: TurnState): Promise<void> {
    console.warn("[AiChat] El turno de cierre tampoco devolvió texto");
    s.finalText = EXHAUSTED_FALLBACK_TEXT;
    s.p.history.push({ role: AiRole.MODEL, parts: [{ text: EXHAUSTED_FALLBACK_TEXT }] });
    await this.emit(s, { type: "text", text: EXHAUSTED_FALLBACK_TEXT });
  }

  private checkCancelled(s: TurnState): boolean {
    if (!s.cancelled && (s.p.signal?.aborted || s.p.isCancelled?.())) s.cancelled = true;
    return s.cancelled;
  }

  private toResult(s: TurnState): AgentLoopResult {
    return {
      text: s.finalText,
      usage: s.usage,
      citedNoteIds: s.citedNoteIds,
      ragAttachments: s.ragAttachments,
      skillMetadata: s.skillMetadata,
      lastInteractionId: s.lastInteractionId,
      modelCalls: s.modelCalls,
    };
  }

  private async finishDone(s: TurnState): Promise<AgentLoopOutcome> {
    const result = this.toResult(s);
    await this.emit(s, { type: "done", ...result });
    return { ...result, cancelled: false };
  }

  private async finishCancelled(s: TurnState): Promise<AgentLoopOutcome> {
    await this.emit(s, { type: "cancelled", modelCalls: s.modelCalls });
    return { ...this.toResult(s), cancelled: true };
  }

  private async emit(s: TurnState, event: AgentEvent): Promise<void> {
    if (s.p.onEvent) await s.p.onEvent(event);
  }
}

/** Una herramienta "salió bien" si su resultado no trae `error` ni `ok: false`. */
function isOkResponse(response: unknown): boolean {
  if (!response || typeof response !== "object" || Array.isArray(response)) return true;
  const r = response as Record<string, unknown>;
  return r.ok !== false && !("error" in r);
}
