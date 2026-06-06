import { Context } from "hono";
import { sendSuccess } from "../../shared/api_response.ts";
import { AiInvokedError, AppError, ConflictError } from "../../shared/errors.ts";
import { AiChatService } from "../../features/ai_chat/ai_chat.service.ts";
import { AiSessionService } from "../../features/ai_chat/ai_session.service.ts";
import { ConfirmPolicySchema } from "../../features/document_processing/confirm_policy.service.ts";
import { UsageService } from "../../modules/subscription/usage.service.ts";
import { StorageService } from "../../modules/storage/storage.service.ts";

const INGEST_POLICY_MIME_TYPE = "application/pdf";
const INGEST_TEXT_SOURCE_TYPES = ["whatsapp", "text"] as const;

export class AiController {
  static async chat(c: Context) {
    const agentId: string = c.get("agent_id");
    const { message, sessionId: session_id } = await c.req.json();

    if (!message) throw new AppError("El campo 'message' es requerido.", 400);

    const usageService = c.get("usage_service") as UsageService;
    await usageService.checkAndIncrementChat(agentId, c.get("plan_limits"));

    const service: AiChatService = c.get("services").aiChatService;
    const response = await service.processMessage(message, agentId, session_id);

    return sendSuccess(c, response);
  }

  static async cancelSession(c: Context) {
    const service: AiChatService = c.get("services").aiChatService;
    const result = await service.cancelSession(c.req.param("sessionId"));
    return sendSuccess(c, { cancelled: true, ...result });
  }

  static async processDocument(c: Context) {
    const agentId: string = c.get("agent_id");
    const { filePath, fileName } = await c.req.json();

    if (!filePath || !fileName) {
      throw new AppError("Los campos 'filePath' y 'fileName' son requeridos.", 400);
    }

    const result = await c.get("services").documentProcessorService.processDocument(agentId, filePath, fileName);
    return sendSuccess(c, result);
  }

  static async uploadFile(c: Context) {
    const agentId: string = c.get("agent_id");
    const usageService = c.get("usage_service") as UsageService;
    await usageService.checkAndIncrementIngestion(agentId, c.get("plan_limits"));

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
    await usageService.checkAndIncrementIngestion(agentId, c.get("plan_limits"));

    const { storagePath, fileName, mimeType, contactId } = await c.req.json();
    if (!storagePath || !fileName || !mimeType) {
      throw new AppError("Se requieren: storagePath, fileName, mimeType.", 400);
    }
    if (mimeType !== INGEST_POLICY_MIME_TYPE) {
      throw new AppError(`ingest-policy solo acepta ${INGEST_POLICY_MIME_TYPE}.`, 400);
    }

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
        extraction as unknown as Record<string, unknown>,
        documentMetadataId,
      );

      return sendSuccess(c, { sessionId, message: text, documentMetadataId, extraction }, 201);
    } catch (err) {
      if (err instanceof AiInvokedError || err instanceof ConflictError) {
        await (aiSessionService as AiSessionService).markSessionFailed(sessionId, err.message);
      } else {
        await (aiSessionService as AiSessionService).deleteSession(sessionId);
      }
      throw err;
    }
  }

  static async ingest(c: Context) {
    const agentId: string = c.get("agent_id");
    const usageService = c.get("usage_service") as UsageService;
    await usageService.checkAndIncrementIngestion(agentId, c.get("plan_limits"));

    const { storagePath, fileName, mimeType, contactId, policyId } = await c.req.json();
    if (!storagePath || !fileName || !mimeType) {
      throw new AppError("Se requieren: storagePath, fileName, mimeType.", 400);
    }

    const storageService = c.get("storage_service") as StorageService;
    storageService.validateMimeType(mimeType);

    const { aiSessionService, knowledgeIngestionService } = c.get("services");
    const sessionId = await (aiSessionService as AiSessionService).createSession(agentId, {
      triggerMessage: "file_ingestion",
      sessionType: "knowledge_ingestion",
    });
    try {
      const { noteId, responseMessage } = await knowledgeIngestionService.ingestFile(agentId, sessionId, {
        storagePath, fileName, mimeType, contactId, policyId,
      });
      return sendSuccess(c, {
        noteId,
        sessionId,
        message: responseMessage,
      }, 201);
    } catch (err) {
      if (err instanceof AiInvokedError) {
        await (aiSessionService as AiSessionService).markSessionFailed(sessionId, err.message);
      } else {
        await (aiSessionService as AiSessionService).deleteSession(sessionId);
      }
      throw err;
    }
  }

  static async ingestText(c: Context) {
    const agentId: string = c.get("agent_id");
    const usageService = c.get("usage_service") as UsageService;
    await usageService.checkAndIncrementIngestion(agentId, c.get("plan_limits"));

    const { content, sourceType, contactId, policyId } = await c.req.json();
    if (!content || !sourceType) {
      throw new AppError("Se requieren: content, sourceType ('whatsapp' | 'text').", 400);
    }
    if (!INGEST_TEXT_SOURCE_TYPES.includes(sourceType)) {
      throw new AppError(`sourceType debe ser: ${INGEST_TEXT_SOURCE_TYPES.join(" | ")}.`, 400);
    }

    const { aiSessionService, knowledgeIngestionService } = c.get("services");
    const sessionId = await (aiSessionService as AiSessionService).createSession(agentId, {
      triggerMessage: "text_ingestion",
      sessionType: "knowledge_ingestion",
    });
    try {
      const { noteId, responseMessage } = await knowledgeIngestionService.ingestText(agentId, sessionId, {
        content, sourceType, contactId, policyId,
      });
      return sendSuccess(c, {
        noteId,
        sessionId,
        message: responseMessage,
      }, 201);
    } catch (err) {
      if (err instanceof AiInvokedError) {
        await (aiSessionService as AiSessionService).markSessionFailed(sessionId, err.message);
      } else {
        await (aiSessionService as AiSessionService).deleteSession(sessionId);
      }
      throw err;
    }
  }

  static async confirmPolicy(c: Context) {
    const agentId: string = c.get("agent_id");
    const body = await c.req.json();

    const parsed = ConfirmPolicySchema.safeParse(body);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      throw new AppError(`Datos inválidos: ${issues}`, 400);
    }

    const result = await c.get("services").confirmPolicyService.confirm(agentId, parsed.data);
    return sendSuccess(c, result);
  }
}
