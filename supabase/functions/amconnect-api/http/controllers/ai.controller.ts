import { Context } from "hono";
import type { ZodIssue } from "zod";
import { sendSuccess } from "../../shared/api_response.ts";
import { AiInvokedError, AiProviderError, AppError, ConflictError } from "../../shared/errors.ts";
import { AiChatService } from "../../features/ai_chat/ai_chat.service.ts";
import { AiSessionService } from "../../features/ai_chat/ai_session.service.ts";
import { ConfirmPolicySchema } from "../../features/document_processing/confirm_policy.service.ts";
import { UsageService } from "../../modules/subscription/usage.service.ts";
import { StorageService } from "../../modules/storage/storage.service.ts";
import {
  AiChatSchema,
  AiIngestFileSchema,
  AiIngestPolicySchema,
  AiIngestTextSchema,
  AiProcessDocumentRequestSchema,
} from "../../features/ai_chat/ai.dto.ts";
export class AiController {
  static async chat(c: Context) {
    const agentId: string = c.get("agent_id");
    const body = await c.req.json();
    const parsed = AiChatSchema.safeParse(body);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i: ZodIssue) => `${i.path.join(".")}: ${i.message}`).join("; ");
      throw new AppError(`Datos inválidos: ${issues}`, 400);
    }
    const { message, sessionId: session_id } = parsed.data;

    const usageService = c.get("usage_service") as UsageService;
    await usageService.checkAndIncrementChat(agentId);

    try {
      const timezone = c.req.header("x-timezone") || "America/Mexico_City";
      const service: AiChatService = c.get("services").aiChatService;
      const response = await service.processMessage(message, agentId, session_id, timezone);
      return sendSuccess(c, response);
    } catch (err) {
      if (err instanceof AiProviderError) {
        // Session already marked inside processMessage; only decrement usage
        await usageService.decrementChat(agentId);
      }
      throw err;
    }
  }

  static async cancelSession(c: Context) {
    const sessionId = c.req.param("sessionId");
    if (!sessionId) throw new AppError("El parámetro 'sessionId' es requerido.", 400);
    const service: AiChatService = c.get("services").aiChatService;
    const result = await service.cancelSession(sessionId);
    return sendSuccess(c, { cancelled: true, ...result });
  }

  static async processDocument(c: Context) {
    const agentId: string = c.get("agent_id");
    const parsed = AiProcessDocumentRequestSchema.safeParse(await c.req.json());
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i: ZodIssue) => `${i.path.join(".")}: ${i.message}`).join("; ");
      throw new AppError(`Datos inválidos: ${issues}`, 400);
    }
    const { filePath, fileName } = parsed.data;
    const result = await c.get("services").documentProcessorService.processDocument(agentId, filePath, fileName);
    return sendSuccess(c, result);
  }

  static async uploadFile(c: Context) {
    const agentId: string = c.get("agent_id");
    const formData = await c.req.formData();
    const file = formData.get("file") as File | null;
    if (!file) throw new AppError("Se requiere el archivo en el campo 'file'.", 400);

    const storageService = c.get("storage_service") as StorageService;
    const result = await storageService.upload(agentId, file);

    return sendSuccess(c, result, 201);
  }

  static async getUploadUrl(c: Context) {
    const agentId: string = c.get("agent_id");

    const fileName = c.req.query("fileName");
    const mimeType = c.req.query("mimeType") ?? "application/pdf";
    if (!fileName) throw new AppError("Se requiere el parámetro 'fileName'.", 400);

    const storageService = c.get("storage_service") as StorageService;
    const result = await storageService.getSignedUploadUrl(agentId, fileName, mimeType);

    return sendSuccess(c, result);
  }

  static async ingestPolicy(c: Context) {
    const agentId: string = c.get("agent_id");
    const usageService = c.get("usage_service") as UsageService;
    await usageService.checkAndIncrementIngestion(agentId);

    const body = await c.req.json();
    const parsed = AiIngestPolicySchema.safeParse(body);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i: ZodIssue) => `${i.path.join(".")}: ${i.message}`).join("; ");
      throw new AppError(`Datos inválidos: ${issues}`, 400);
    }
    const { storagePath, fileName, mimeType, contactId } = parsed.data;

    const { aiSessionService, policyIngestionService, aiChatService } = c.get("services");
    const sessionId = await (aiSessionService as AiSessionService).createSession(agentId, {
      triggerMessage: "policy_ingestion",
      sessionType: "policy_ingestion",
    });
    try {
      const { extraction, documentMetadataId } = await policyIngestionService.extract(agentId, sessionId, {
        storagePath, fileName, mimeType, contactId,
      });

      const { text } = await aiChatService.startPolicySession(
        sessionId,
        agentId,
        extraction,
        documentMetadataId,
      );

      return sendSuccess(c, { sessionId, message: text, documentMetadataId, extraction }, 201);
    } catch (err) {
      if (err instanceof AiProviderError) {
        await Promise.all([
          (aiSessionService as AiSessionService).markSessionProviderError(sessionId, err.message),
          usageService.decrementIngestion(agentId),
        ]);
      } else if (err instanceof AiInvokedError || err instanceof ConflictError) {
        await (aiSessionService as AiSessionService).markSessionFailed(sessionId, err.message);
      } else {
        await Promise.all([
          (aiSessionService as AiSessionService).deleteSession(sessionId),
          usageService.decrementIngestion(agentId),
        ]);
      }
      throw err;
    }
  }

  static async ingest(c: Context) {
    const agentId: string = c.get("agent_id");
    const usageService = c.get("usage_service") as UsageService;
    await usageService.checkAndIncrementIngestion(agentId);

    const body = await c.req.json();
    const parsed = AiIngestFileSchema.safeParse(body);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i: ZodIssue) => `${i.path.join(".")}: ${i.message}`).join("; ");
      throw new AppError(`Datos inválidos: ${issues}`, 400);
    }
    const { storagePath, fileName, mimeType, contactId, policyId } = parsed.data;

    const storageService = c.get("storage_service") as StorageService;
    storageService.validateMimeType(mimeType);

    const advisorLocale = c.req.header('Accept-Language')?.split(',')[0]?.split(';')[0]?.trim() ?? 'es';

    const { aiSessionService, knowledgeIngestionService } = c.get("services");
    const sessionId = await (aiSessionService as AiSessionService).createSession(agentId, {
      triggerMessage: "file_ingestion",
      sessionType: "knowledge_ingestion",
    });
    try {
      const { noteId, responseMessage } = await knowledgeIngestionService.ingestFile(agentId, sessionId, {
        storagePath, fileName, mimeType, contactId, policyId, advisorLocale,
      });
      return sendSuccess(c, {
        noteId,
        sessionId,
        message: responseMessage,
      }, 201);
    } catch (err) {
      if (err instanceof AiProviderError) {
        await Promise.all([
          (aiSessionService as AiSessionService).markSessionProviderError(sessionId, err.message),
          usageService.decrementIngestion(agentId),
        ]);
      } else if (err instanceof AiInvokedError) {
        await (aiSessionService as AiSessionService).markSessionFailed(sessionId, err.message);
      } else {
        await Promise.all([
          (aiSessionService as AiSessionService).deleteSession(sessionId),
          usageService.decrementIngestion(agentId),
        ]);
      }
      throw err;
    }
  }

  static async ingestText(c: Context) {
    const agentId: string = c.get("agent_id");
    const usageService = c.get("usage_service") as UsageService;
    debugger;
    await usageService.checkAndIncrementIngestion(agentId);

    const body = await c.req.json();
    const parsed = AiIngestTextSchema.safeParse(body);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i: ZodIssue) => `${i.path.join(".")}: ${i.message}`).join("; ");
      throw new AppError(`Datos inválidos: ${issues}`, 400);
    }
    const { content, sourceType, contactId, policyId } = parsed.data;

    const advisorLocale = c.req.header('Accept-Language')?.split(',')[0]?.split(';')[0]?.trim() ?? 'es';

    const { aiSessionService, knowledgeIngestionService } = c.get("services");
    const sessionId = await (aiSessionService as AiSessionService).createSession(agentId, {
      triggerMessage: "text_ingestion",
      sessionType: "knowledge_ingestion",
    });
    try {
      const { noteId, responseMessage } = await knowledgeIngestionService.ingestText(agentId, sessionId, {
        content, sourceType, contactId, policyId, advisorLocale,
      });
      return sendSuccess(c, {
        noteId,
        sessionId,
        message: responseMessage,
      }, 201);
    } catch (err) {
      if (err instanceof AiProviderError) {
        await Promise.all([
          (aiSessionService as AiSessionService).markSessionProviderError(sessionId, err.message),
          usageService.decrementIngestion(agentId),
        ]);
      } else if (err instanceof AiInvokedError) {
        await (aiSessionService as AiSessionService).markSessionFailed(sessionId, err.message);
      } else {
        await Promise.all([
          (aiSessionService as AiSessionService).deleteSession(sessionId),
          usageService.decrementIngestion(agentId),
        ]);
      }
      throw err;
    }
  }

  static async confirmPolicy(c: Context) {
    const agentId: string = c.get("agent_id");
    const body = await c.req.json();

    const parsed = ConfirmPolicySchema.safeParse(body);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i: ZodIssue) => `${i.path.join(".")}: ${i.message}`).join("; ");
      throw new AppError(`Datos inválidos: ${issues}`, 400);
    }

    const result = await c.get("services").confirmPolicyService.confirm(agentId, parsed.data);
    return sendSuccess(c, result);
  }

  static async getSessionCost(c: Context) {
    const sessionId = c.req.param("sessionId");
    if (!sessionId) throw new AppError("El parámetro 'sessionId' es requerido.", 400);

    const aiSessionService = c.get("services").aiSessionService as AiSessionService;
    const result = await aiSessionService.getSessionCost(sessionId);
    return sendSuccess(c, result);
  }

  static async ragSearch(c: Context) {
    const agentId: string = c.get("agent_id");
    const body = await c.req.json();
    const { query, contactId, policyId, threshold, limit } = body;
    if (!query || typeof query !== "string") throw new AppError("El campo 'query' es requerido.", 400);

    const ragService = c.get("services").ragService;
    const results = await ragService.searchNotes(agentId, query, {
      contactId: contactId ?? undefined,
      policyId: policyId ?? undefined,
      threshold: typeof threshold === "number" ? threshold : 0.5,
      limit: typeof limit === "number" ? limit : 10,
    });
    return sendSuccess(c, results);
  }
}
