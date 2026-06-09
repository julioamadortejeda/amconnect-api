import type { IAiSessionRepository, IngestionUsageRow, ChatMessageRow } from "./ai_session.repository.ts";

export interface CreateSessionInput {
  triggerMessage: string;
  sessionType: "chat" | "knowledge_ingestion" | "policy_ingestion";
  modelName?: string | null;
  embeddingModelName?: string | null;
}

export interface UsageTokens {
  promptTokens: number;
  completionTokens: number;
  totalTokens: number;
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
      modelName: input.modelName ?? Deno.env.get("GEMINI_MODEL") ?? "gemini-3.1-flash-lite",
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
        itemCount: embeddingCount,
      },
    ];

    await this.repository.insertIngestionUsage(rows);
    await this.repository.updateSession(sessionId, {
      embeddingModelName,
      extractionPromptTokens: extractionUsage?.promptTokens ?? 0,
      extractionCompletionTokens: extractionUsage?.completionTokens ?? 0,
      extractionTotalTokens: extractionUsage?.totalTokens ?? 0,
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
      itemCount: 1,
    });
    await this.repository.updateSession(sessionId, {
      extractionPromptTokens: extractionUsage?.promptTokens ?? 0,
      extractionCompletionTokens: extractionUsage?.completionTokens ?? 0,
      extractionTotalTokens: extractionUsage?.totalTokens ?? 0,
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
  ): Promise<void> {
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

    await Promise.all([
      this.repository.updateSession(sessionId, {
        history,
        promptTokens: current.promptTokens + deltaUsage.promptTokens,
        completionTokens: current.completionTokens + deltaUsage.completionTokens,
        totalTokens: current.totalTokens + deltaUsage.totalTokens,
      }),
      this.repository.insertChatMessages(chatMessageRows),
    ]);
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
}
