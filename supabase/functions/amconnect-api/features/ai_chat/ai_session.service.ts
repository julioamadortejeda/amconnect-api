import type { IAiSessionRepository, TokenUsageRow, ChatMessageRow, PendingTaskRow, ModelRatesRow } from "./ai_session.repository.ts";
import { AppError, ConflictError, NotFoundError } from "../../shared/errors.ts";

/**
 * Cuánto dura el candado de turno si nadie lo libera (proceso caído).
 * Debe superar con holgura el turno más largo: MAX_LOOPS (6) vueltas + turno de
 * cierre + clasificador, cada una con reintentos de `withAiRetry`. Se libera en
 * `finally`, así que este tiempo solo importa ante un crash.
 */
export const TURN_LOCK_SECONDS = 120;

export interface CreateSessionInput {
  triggerMessage: string;
  sessionType: "chat" | "knowledge_ingestion" | "policy_ingestion" | "voice";
  // Obligatorio y sin fallback: cada caller declara el modelo que realmente
  // usará (AI_MODEL, LIVE_AUDIO_MODEL...) — de esto dependen los costos.
  modelName: string;
  embeddingModelName?: string | null;
}

export interface UsageTokens {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens?: number;
  thoughtsTokens?: number;
}

export interface ChatMessageInput {
  role: string;
  content: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens?: number;
  thoughtsTokens?: number;
  interactionId?: string | null;
  textPromptTokens?: number;
  audioPromptTokens?: number;
  textCompletionTokens?: number;
  audioCompletionTokens?: number;
}

export class AiSessionService {
  constructor(private repository: IAiSessionRepository) {}

  async createSession(agentId: string, input: CreateSessionInput): Promise<string> {
    return await this.repository.createSession({
      agentId,
      triggerMessage: input.triggerMessage,
      history: [],
      type: input.sessionType,
      modelName: input.modelName,
      embeddingModelName: input.embeddingModelName,
    });
  }

  /**
   * Toma el candado de turno de una sesión existente ANTES de gastar modelo o
   * cuota. 404 si no existe/es ajena, 409 si ya hay un turno en curso. Quien lo
   * toma DEBE llamar `releaseTurnLock` en un `finally`.
   */
  async acquireTurnLock(sessionId: string): Promise<void> {
    const acquired = await this.repository.acquireTurnLock(sessionId, new Date(), TURN_LOCK_SECONDS * 1000);
    if (acquired) return;
    // El UPDATE no distingue "bloqueada" de "no existe / ajena" (RLS): se
    // desambigua solo en la ruta de fallo.
    const session = await this.repository.getSessionContext(sessionId);
    if (!session) throw new NotFoundError("Sesión no encontrada.");
    throw new ConflictError("Todavía estoy respondiendo tu mensaje anterior en esta conversación.");
  }

  /** Un fallo al liberar no debe tapar el resultado (ni el error) del turno; el candado expira solo. */
  async releaseTurnLock(sessionId: string): Promise<void> {
    try {
      await this.repository.releaseTurnLock(sessionId);
    } catch (e) {
      console.error("[AiSession] No se pudo liberar el candado de turno (expira solo):", e);
    }
  }

  async trackIngestionUsage(
    agentId: string,
    sessionId: string,
    docMetaId: string | null,
    extractionModelName: string,
    extractionUsage: UsageTokens | undefined,
    embeddingModelName: string,
    embeddingTotalTokens: number,
    _embeddingCount: number,
    noteId?: string | null,
  ): Promise<void> {
    const rows: TokenUsageRow[] = [];
    // Sin extractionUsage no hubo llamada de IA que resumir (ej. nota rápida
    // que se saltó generateStructuredData) — no insertar una fila en ceros.
    if (extractionUsage) {
      rows.push({
        agentId,
        sessionId,
        documentMetadataId: docMetaId,
        noteId: noteId ?? null,
        source: "extraction",
        modelName: extractionModelName,
        promptTokens: extractionUsage.promptTokens,
        completionTokens: extractionUsage.completionTokens,
        cachedTokens: extractionUsage.cachedTokens ?? 0,
        thoughtsTokens: extractionUsage.thoughtsTokens ?? 0,
      });
    }
    rows.push({
      agentId,
      sessionId,
      documentMetadataId: docMetaId,
      noteId: noteId ?? null,
      source: "embedding",
      modelName: embeddingModelName,
      promptTokens: embeddingTotalTokens,
      completionTokens: 0,
      cachedTokens: 0,
    });

    await this.repository.logTokenUsage(rows);
    await this.repository.updateSession(sessionId, {
      embeddingModelName,
    });
  }

  async trackExtractionUsageOnly(
    agentId: string,
    sessionId: string,
    docMetaId: string | null,
    extractionModelName: string,
    extractionUsage: UsageTokens | undefined,
  ): Promise<void> {
    await this.repository.logTokenUsage({
      agentId,
      sessionId,
      documentMetadataId: docMetaId,
      source: "extraction",
      modelName: extractionModelName,
      promptTokens: extractionUsage?.promptTokens ?? 0,
      completionTokens: extractionUsage?.completionTokens ?? 0,
      cachedTokens: extractionUsage?.cachedTokens ?? 0,
      thoughtsTokens: extractionUsage?.thoughtsTokens ?? 0,
    });
  }

  async trackEmbeddingUsageOnly(
    agentId: string,
    sessionId: string,
    docMetaId: string | null,
    embeddingModelName: string,
    embeddingTotalTokens: number,
    _embeddingCount: number,
  ): Promise<void> {
    await this.repository.logTokenUsage({
      agentId,
      sessionId,
      documentMetadataId: docMetaId,
      source: "embedding",
      modelName: embeddingModelName,
      promptTokens: embeddingTotalTokens,
      completionTokens: 0,
      cachedTokens: 0,
    });
    await this.repository.updateSession(sessionId, {
      embeddingModelName,
    });
  }

  async saveChatRound(
    agentId: string,
    sessionId: string,
    history: unknown[],
    messages: ChatMessageInput[],
    deltaUsage: UsageTokens,
    lastInteractionId?: string | null,
    durationSeconds?: number,
    replaceTokens = false,
  ): Promise<UsageTokens> {
    const chatMessageRows: ChatMessageRow[] = messages.map((m) => ({
      agentId,
      sessionId,
      role: m.role,
      content: m.content,
      interactionId: m.interactionId ?? null,
    }));

    const sessionCtx = await this.repository.getSessionContext(sessionId).catch(() => null);
    // Sin fallback: costear tokens con el modelo equivocado es peor que fallar.
    const modelName = sessionCtx?.modelName;
    if (!modelName) {
      throw new AppError(
        "La sesión no tiene modelo registrado — no se puede costear el uso de tokens.",
        500,
      );
    }
    const source = sessionCtx?.type === "voice" || sessionCtx?.type === "chat_voice" ? "chat_voice" : "chat_text";

    const tokenUsageRows: TokenUsageRow[] = [];
    for (const m of messages) {
      if (m.promptTokens > 0 || m.completionTokens > 0 || (m.thoughtsTokens ?? 0) > 0) {
        tokenUsageRows.push({
          agentId,
          sessionId,
          source,
          modelName,
          promptTokens: m.promptTokens,
          completionTokens: m.completionTokens,
          cachedTokens: m.cachedTokens ?? 0,
          thoughtsTokens: m.thoughtsTokens ?? 0,
          textPromptTokens: m.textPromptTokens,
          audioPromptTokens: m.audioPromptTokens,
          textCompletionTokens: m.textCompletionTokens,
          audioCompletionTokens: m.audioCompletionTokens,
        });
      }
    }

    if (tokenUsageRows.length > 0) {
      await this.repository.logTokenUsage(tokenUsageRows);
    }

    // El acumulado de la sesión se calcula SIEMPRE desde tokens_usage (única
    // fuente de verdad; ai_sessions ya no guarda tokens). Las filas de este
    // turno se insertaron arriba, así que `current` ya las incluye: sumarles
    // `deltaUsage` contaba el turno dos veces. Con `replaceTokens` (voz por
    // WebSocket) el delta es el snapshot acumulado de toda la sesión.
    const nextTokens: UsageTokens = replaceTokens
      ? {
          promptTokens: deltaUsage.promptTokens,
          completionTokens: deltaUsage.completionTokens,
          totalTokens: deltaUsage.totalTokens,
          cachedTokens: deltaUsage.cachedTokens ?? 0,
          thoughtsTokens: deltaUsage.thoughtsTokens ?? 0,
        }
      : await this.repository.getSessionTokens(sessionId);

    await Promise.all([
      this.repository.updateSession(sessionId, {
        history,
        lastInteractionId,
        durationSeconds,
      }),
      this.repository.insertChatMessages(chatMessageRows),
    ]);

    return nextTokens;
  }

  async updateMetadata(sessionId: string, metadata: Record<string, unknown>): Promise<void> {
    await this.repository.updateSession(sessionId, { metadata });
  }

  async markSessionFailed(sessionId: string, errorMessage: string): Promise<void> {
    await this.repository.updateSession(sessionId, {
      status: "failed",
      metadata: { error: errorMessage },
    });
  }

  async markSessionProviderError(sessionId: string, errorMessage: string): Promise<void> {
    await this.repository.updateSession(sessionId, {
      status: "provider_error",
      isBillable: false,
      metadata: { error: errorMessage },
    });
  }

  /**
   * Turno cancelado a medias. Reusa el status `cancelled` (el mismo de "el
   * asesor salió del chat"); no toca `metadata` (la pisaría) ni `is_billable`
   * (lo que Gemini ya procesó se cobra). La sesión sigue usable: ningún turno
   * revisa el status.
   */
  async markSessionCancelled(sessionId: string): Promise<void> {
    await this.repository.updateSession(sessionId, { status: "cancelled" });
  }

  async deleteSession(sessionId: string): Promise<void> {
    await this.repository.deleteSession(sessionId);
  }

  async getSessionMetadata(sessionId: string): Promise<Record<string, unknown> | null> {
    return await this.repository.getMetadata(sessionId);
  }

  async savePendingTask(sessionId: string, agentId: string, taskType: string, payload: Record<string, unknown>): Promise<string> {
    return await this.repository.savePendingTask(sessionId, agentId, taskType, payload);
  }

  async resolvePendingTask(pendingTaskId: string, sessionId: string): Promise<void> {
    await this.repository.resolvePendingTask(pendingTaskId, sessionId);
  }

  async cancelSession(sessionId: string): Promise<{ cancelledTasks: number }> {
    const session = await this.repository.getSessionContext(sessionId);
    if (!session) throw new AppError("Sesión no encontrada.", 404);

    const [cancelledTasks] = await Promise.all([
      this.repository.cancelPendingTasksBySession(sessionId),
      this.repository.updateSession(sessionId, { status: "cancelled" }),
    ]);
    return { cancelledTasks };
  }

  async getSessionContext(sessionId: string): Promise<{ history: unknown[]; type: string; last_interaction_id?: string | null; createdAt?: string } | null> {
    return await this.repository.getSessionContext(sessionId);
  }


  async getActivePendingTasks(sessionId: string): Promise<PendingTaskRow[]> {
    return await this.repository.getActivePendingTasks(sessionId);
  }

  async getSessionCost(sessionId: string): Promise<Record<string, unknown>> {
    const [data, usage] = await Promise.all([
      this.repository.getSessionWithRates(sessionId),
      this.repository.getSessionTokenUsageDetails(sessionId),
    ]);
    if (!data) throw new AppError("Sesión no encontrada.", 404);

    const unwrap = (m: ModelRatesRow | ModelRatesRow[] | null): ModelRatesRow | null =>
      Array.isArray(m) ? m[0] ?? null : m;
    const chatModel = unwrap(data.chat_model);
    const embeddingModel = unwrap(data.embedding_model);
    const ttsModel = unwrap(data.tts_model);

    // El audio y el texto NO cuestan lo mismo en los modelos live: para
    // gemini-live-2.5-flash-native-audio el texto de entrada vale $0.50/1M y el
    // audio $3.00 — seis veces más. Cobrar todo a la tarifa de audio inflaba la
    // factura 3.5x en una sesión real de voz, porque el prompt es casi todo
    // texto (instrucciones + las 43 declaraciones de herramientas, que la Live
    // API reenvía en cada turno).
    //
    // `desglose` es opcional a propósito: los modelos que no distinguen
    // modalidad dejan las columnas de audio en NULL y todo se cobra a la tarifa
    // de texto, que es su única tarifa.
    const calcCosts = (
      promptTokens: number,
      cachedTokens: number,
      completionTokens: number,
      thoughtsTokens: number,
      model: ModelRatesRow | null,
      desglose?: {
        textPromptTokens: number;
        audioPromptTokens: number;
        textCompletionTokens: number;
        audioCompletionTokens: number;
      },
    ) => {
      if (!model) return { inputCostUsd: 0, cacheReadCostUsd: 0, outputCostUsd: 0, totalCostUsd: 0 };

      const tarifaTexto = Number(model.input_cost_per_1m);
      const tarifaAudioIn = model.audio_input_cost_per_1m != null
        ? Number(model.audio_input_cost_per_1m)
        : tarifaTexto;
      const tarifaSalidaTexto = Number(model.output_cost_per_1m);
      const tarifaAudioOut = model.audio_output_cost_per_1m != null
        ? Number(model.audio_output_cost_per_1m)
        : tarifaSalidaTexto;

      const cacheReadCostUsd = (cachedTokens * Number(model.cache_read_cost_per_1m ?? 0)) / 1_000_000;

      // Sin desglose —o con uno que no suma nada, que es lo que traen las filas
      // viejas— se cae al comportamiento anterior en vez de cobrar cero.
      const hayDesglose = desglose &&
        (desglose.textPromptTokens + desglose.audioPromptTokens) > 0;

      if (!hayDesglose) {
        const nonCached = Math.max(0, promptTokens - cachedTokens);
        const inputCostUsd = (nonCached * tarifaTexto) / 1_000_000;
        // Los thoughts se cobran a tarifa de salida de texto.
        const outputCostUsd = ((completionTokens + thoughtsTokens) * tarifaSalidaTexto) / 1_000_000;
        return { inputCostUsd, cacheReadCostUsd, outputCostUsd, totalCostUsd: inputCostUsd + cacheReadCostUsd + outputCostUsd };
      }

      // Lo cacheado se descuenta del texto: el prefijo que se repite entre
      // turnos son las instrucciones y las herramientas, nunca el audio.
      const textoSinCache = Math.max(0, desglose.textPromptTokens - cachedTokens);
      const inputCostUsd =
        (textoSinCache * tarifaTexto + desglose.audioPromptTokens * tarifaAudioIn) / 1_000_000;
      const outputCostUsd =
        (desglose.textCompletionTokens * tarifaSalidaTexto +
          desglose.audioCompletionTokens * tarifaAudioOut +
          thoughtsTokens * tarifaSalidaTexto) / 1_000_000;

      return { inputCostUsd, cacheReadCostUsd, outputCostUsd, totalCostUsd: inputCostUsd + cacheReadCostUsd + outputCostUsd };
    };

    const chatCosts = calcCosts(usage.chat.promptTokens, usage.chat.cachedTokens, usage.chat.completionTokens, usage.chat.thoughtsTokens, chatModel, usage.chat);
    const extractionCosts = calcCosts(usage.extraction.promptTokens, usage.extraction.cachedTokens, usage.extraction.completionTokens, usage.extraction.thoughtsTokens, chatModel, usage.extraction);

    let embeddingCostUsd = 0;
    if (embeddingModel) {
      embeddingCostUsd = (usage.embedding.totalTokens * Number(embeddingModel.input_cost_per_1m)) / 1_000_000;
    }

    const ttsCosts = calcCosts(data.tts_prompt_tokens ?? 0, 0, data.tts_completion_tokens ?? 0, 0, ttsModel);

    const totalCostUsd = chatCosts.totalCostUsd + extractionCosts.totalCostUsd + embeddingCostUsd + ttsCosts.totalCostUsd;

    return {
      sessionId: data.id,
      chat: {
        model: data.model_name ?? null,
        displayName: chatModel?.display_name ?? null,
        promptTokens: usage.chat.promptTokens,
        completionTokens: usage.chat.completionTokens,
        totalTokens: usage.chat.totalTokens,
        cachedTokens: usage.chat.cachedTokens,
        thoughtsTokens: usage.chat.thoughtsTokens,
        cost: {
          inputUsd: chatCosts.inputCostUsd,
          cacheReadUsd: chatCosts.cacheReadCostUsd,
          outputUsd: chatCosts.outputCostUsd,
          totalUsd: chatCosts.totalCostUsd,
        },
      },
      extraction: {
        model: data.model_name ?? null,
        displayName: chatModel?.display_name ?? null,
        promptTokens: usage.extraction.promptTokens,
        completionTokens: usage.extraction.completionTokens,
        totalTokens: usage.extraction.totalTokens,
        cachedTokens: usage.extraction.cachedTokens,
        thoughtsTokens: usage.extraction.thoughtsTokens,
        cost: {
          inputUsd: extractionCosts.inputCostUsd,
          cacheReadUsd: extractionCosts.cacheReadCostUsd,
          outputUsd: extractionCosts.outputCostUsd,
          totalUsd: extractionCosts.totalCostUsd,
        },
      },
      embedding: {
        model: data.embedding_model_name ?? null,
        displayName: embeddingModel?.display_name ?? null,
        totalTokens: usage.embedding.totalTokens,
        count: 0,
        cost: {
          inputUsd: embeddingCostUsd,
          totalUsd: embeddingCostUsd,
        },
      },
      tts: {
        model: data.tts_model_name ?? null,
        displayName: ttsModel?.display_name ?? null,
        promptTokens: data.tts_prompt_tokens ?? 0,
        completionTokens: data.tts_completion_tokens ?? 0,
        totalTokens: data.tts_total_tokens ?? 0,
        cost: {
          inputUsd: ttsCosts.inputCostUsd,
          outputUsd: ttsCosts.outputCostUsd,
          totalUsd: ttsCosts.totalCostUsd,
        },
      },
      totalCostUsd,
    };
  }
}
