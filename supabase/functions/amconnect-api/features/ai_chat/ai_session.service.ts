import type { IAiSessionRepository, IngestionUsageRow, ChatMessageRow, PendingTaskRow } from "./ai_session.repository.ts";
import { AI_MODEL } from "../../shared/config.ts";
import { AppError } from "../../shared/errors.ts";

export interface CreateSessionInput {
  triggerMessage: string;
  sessionType: "chat" | "knowledge_ingestion" | "policy_ingestion" | "voice";
  modelName?: string | null;
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
}

export class AiSessionService {
  constructor(private repository: IAiSessionRepository) {}

  async createSession(agentId: string, input: CreateSessionInput): Promise<string> {
    return await this.repository.createSession({
      agentId,
      triggerMessage: input.triggerMessage,
      history: [],
      type: input.sessionType,
      modelName: input.modelName ?? AI_MODEL,
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
    embeddingCount: number,
  ): Promise<void> {
    const rows: IngestionUsageRow[] = [
      {
        agentId,
        sessionId,
        documentMetadataId: docMetaId,
        operation: "extraction",
        modelName: extractionModelName,
        promptTokens: extractionUsage?.promptTokens ?? 0,
        completionTokens: extractionUsage?.completionTokens ?? 0,
        totalTokens: extractionUsage?.totalTokens ?? 0,
        cachedTokens: extractionUsage?.cachedTokens ?? 0,
        itemCount: 1,
      },
      {
        agentId,
        sessionId,
        documentMetadataId: docMetaId,
        operation: "embedding",
        modelName: embeddingModelName,
        promptTokens: 0,
        completionTokens: 0,
        totalTokens: embeddingTotalTokens,
        cachedTokens: 0,
        itemCount: embeddingCount,
      },
    ];

    await this.repository.insertIngestionUsage(rows);
    await this.repository.updateSession(sessionId, {
      embeddingModelName,
      extractionPromptTokens: extractionUsage?.promptTokens ?? 0,
      extractionCompletionTokens: extractionUsage?.completionTokens ?? 0,
      extractionTotalTokens: extractionUsage?.totalTokens ?? 0,
      extractionCachedTokens: extractionUsage?.cachedTokens ?? 0,
      embeddingTotalTokens,
      embeddingCount,
    });
  }

  async trackExtractionUsageOnly(
    agentId: string,
    sessionId: string,
    docMetaId: string | null,
    extractionModelName: string,
    extractionUsage: UsageTokens | undefined,
  ): Promise<void> {
    await this.repository.insertIngestionUsage({
      agentId,
      sessionId,
      documentMetadataId: docMetaId,
      operation: "extraction",
      modelName: extractionModelName,
      promptTokens: extractionUsage?.promptTokens ?? 0,
      completionTokens: extractionUsage?.completionTokens ?? 0,
      totalTokens: extractionUsage?.totalTokens ?? 0,
      cachedTokens: extractionUsage?.cachedTokens ?? 0,
      itemCount: 1,
    });
    await this.repository.updateSession(sessionId, {
      extractionPromptTokens: extractionUsage?.promptTokens ?? 0,
      extractionCompletionTokens: extractionUsage?.completionTokens ?? 0,
      extractionTotalTokens: extractionUsage?.totalTokens ?? 0,
      extractionCachedTokens: extractionUsage?.cachedTokens ?? 0,
    });
  }

  async trackEmbeddingUsageOnly(
    agentId: string,
    sessionId: string,
    docMetaId: string | null,
    embeddingModelName: string,
    embeddingTotalTokens: number,
    embeddingCount: number,
  ): Promise<void> {
    await this.repository.insertIngestionUsage({
      agentId,
      sessionId,
      documentMetadataId: docMetaId,
      operation: "embedding",
      modelName: embeddingModelName,
      promptTokens: 0,
      completionTokens: 0,
      totalTokens: embeddingTotalTokens,
      cachedTokens: 0,
      itemCount: embeddingCount,
    });
    await this.repository.updateSession(sessionId, {
      embeddingModelName,
      embeddingTotalTokens,
      embeddingCount,
    });
  }

  async saveChatRound(
    agentId: string,
    sessionId: string,
    history: unknown[],
    messages: ChatMessageInput[],
    deltaUsage: UsageTokens,
  ): Promise<UsageTokens> {
    const chatMessageRows: ChatMessageRow[] = messages.map((m) => ({
      agentId,
      sessionId,
      role: m.role,
      content: m.content,
      promptTokens: m.promptTokens,
      completionTokens: m.completionTokens,
      totalTokens: m.totalTokens,
    }));

    const current = await this.repository.getSessionTokens(sessionId);
    const nextTokens = {
      promptTokens: current.promptTokens + deltaUsage.promptTokens,
      completionTokens: current.completionTokens + deltaUsage.completionTokens,
      totalTokens: current.totalTokens + deltaUsage.totalTokens,
      cachedTokens: current.cachedTokens + (deltaUsage.cachedTokens ?? 0),
    };

    await Promise.all([
      this.repository.updateSession(sessionId, {
        history,
        ...nextTokens,
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

  async getSessionContext(sessionId: string): Promise<{ history: unknown[]; type: string } | null> {
    return await this.repository.getSessionContext(sessionId);
  }

  async getActivePendingTasks(sessionId: string): Promise<PendingTaskRow[]> {
    return await this.repository.getActivePendingTasks(sessionId);
  }

  async getSessionCost(sessionId: string): Promise<Record<string, any>> {
    const data = await this.repository.getSessionWithRates(sessionId);
    if (!data) throw new AppError("Sesión no encontrada.", 404);

    // deno-lint-ignore any
    const chatModel = data.chat_model ? (Array.isArray(data.chat_model) ? data.chat_model[0] : data.chat_model) as any : null;
    // deno-lint-ignore any
    const embeddingModel = data.embedding_model ? (Array.isArray(data.embedding_model) ? data.embedding_model[0] : data.embedding_model) as any : null;

    const calcCosts = (promptTokens: number, cachedTokens: number, completionTokens: number, model: any) => {
      if (!model) return { inputCostUsd: 0, cacheReadCostUsd: 0, outputCostUsd: 0, totalCostUsd: 0 };
      const nonCached = Math.max(0, promptTokens - cachedTokens);
      const inputCostUsd = (nonCached * Number(model.input_cost_per_1m)) / 1_000_000;
      const cacheReadCostUsd = (cachedTokens * Number(model.cache_read_cost_per_1m ?? 0)) / 1_000_000;
      const outputCostUsd = (completionTokens * Number(model.output_cost_per_1m)) / 1_000_000;
      return { inputCostUsd, cacheReadCostUsd, outputCostUsd, totalCostUsd: inputCostUsd + cacheReadCostUsd + outputCostUsd };
    };

    const chatCosts = calcCosts(data.prompt_tokens, data.cached_tokens ?? 0, data.completion_tokens, chatModel);
    const extractionCosts = calcCosts(data.extraction_prompt_tokens, data.extraction_cached_tokens ?? 0, data.extraction_completion_tokens, chatModel);

    let embeddingCostUsd = 0;
    if (embeddingModel) {
      embeddingCostUsd = (data.embedding_total_tokens * Number(embeddingModel.input_cost_per_1m)) / 1_000_000;
    }

    const totalCostUsd = chatCosts.totalCostUsd + extractionCosts.totalCostUsd + embeddingCostUsd;

    return {
      sessionId: data.id,
      chat: {
        model: data.model_name ?? null,
        displayName: chatModel?.display_name ?? null,
        promptTokens: data.prompt_tokens,
        completionTokens: data.completion_tokens,
        totalTokens: data.total_tokens,
        cachedTokens: data.cached_tokens ?? 0,
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
        promptTokens: data.extraction_prompt_tokens,
        completionTokens: data.extraction_completion_tokens,
        totalTokens: data.extraction_total_tokens,
        cachedTokens: data.extraction_cached_tokens ?? 0,
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
        totalTokens: data.embedding_total_tokens,
        count: data.embedding_count,
        cost: {
          inputUsd: embeddingCostUsd,
          totalUsd: embeddingCostUsd,
        },
      },
      totalCostUsd,
    };
  }
}
