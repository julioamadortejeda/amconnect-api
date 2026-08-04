import type { IAiSessionRepository, TokenUsageRow, ChatMessageRow, PendingTaskRow } from "./ai_session.repository.ts";
import { AppError } from "../../shared/errors.ts";

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
}

export interface ChatMessageInput {
  role: string;
  content: string | null;
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
  cachedTokens?: number;
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
      if (m.promptTokens > 0 || m.completionTokens > 0) {
        tokenUsageRows.push({
          agentId,
          sessionId,
          source,
          modelName,
          promptTokens: m.promptTokens,
          completionTokens: m.completionTokens,
          cachedTokens: m.cachedTokens ?? 0,
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

    const current = await this.repository.getSessionTokens(sessionId);
    const nextTokens = replaceTokens
      ? {
          promptTokens: deltaUsage.promptTokens,
          completionTokens: deltaUsage.completionTokens,
          totalTokens: deltaUsage.totalTokens,
          cachedTokens: deltaUsage.cachedTokens ?? 0,
        }
      : {
          promptTokens: current.promptTokens + deltaUsage.promptTokens,
          completionTokens: current.completionTokens + deltaUsage.completionTokens,
          totalTokens: current.totalTokens + deltaUsage.totalTokens,
          cachedTokens: current.cachedTokens + (deltaUsage.cachedTokens ?? 0),
        };

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

  async getSessionCost(sessionId: string): Promise<Record<string, any>> {
    const [data, usage] = await Promise.all([
      this.repository.getSessionWithRates(sessionId),
      this.repository.getSessionTokenUsageDetails(sessionId),
    ]);
    if (!data) throw new AppError("Sesión no encontrada.", 404);

    // deno-lint-ignore any
    const chatModel = data.chat_model ? (Array.isArray(data.chat_model) ? data.chat_model[0] : data.chat_model) as any : null;
    // deno-lint-ignore any
    const embeddingModel = data.embedding_model ? (Array.isArray(data.embedding_model) ? data.embedding_model[0] : data.embedding_model) as any : null;
    // deno-lint-ignore any
    const ttsModel = data.tts_model ? (Array.isArray(data.tts_model) ? data.tts_model[0] : data.tts_model) as any : null;

    const calcCosts = (promptTokens: number, cachedTokens: number, completionTokens: number, model: any) => {
      if (!model) return { inputCostUsd: 0, cacheReadCostUsd: 0, outputCostUsd: 0, totalCostUsd: 0 };
      const nonCached = Math.max(0, promptTokens - cachedTokens);
      const inputCostUsd = (nonCached * Number(model.input_cost_per_1m)) / 1_000_000;
      const cacheReadCostUsd = (cachedTokens * Number(model.cache_read_cost_per_1m ?? 0)) / 1_000_000;
      const outputCostUsd = (completionTokens * Number(model.output_cost_per_1m)) / 1_000_000;
      return { inputCostUsd, cacheReadCostUsd, outputCostUsd, totalCostUsd: inputCostUsd + cacheReadCostUsd + outputCostUsd };
    };

    const chatCosts = calcCosts(usage.chat.promptTokens, usage.chat.cachedTokens, usage.chat.completionTokens, chatModel);
    const extractionCosts = calcCosts(usage.extraction.promptTokens, usage.extraction.cachedTokens, usage.extraction.completionTokens, chatModel);

    let embeddingCostUsd = 0;
    if (embeddingModel) {
      embeddingCostUsd = (usage.embedding.totalTokens * Number(embeddingModel.input_cost_per_1m)) / 1_000_000;
    }

    const ttsCosts = calcCosts(data.tts_prompt_tokens ?? 0, 0, data.tts_completion_tokens ?? 0, ttsModel);

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
