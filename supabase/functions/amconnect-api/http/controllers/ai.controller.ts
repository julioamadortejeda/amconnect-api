import { Context } from "hono";
import { sendSuccess } from "../../shared/api_response.ts";
import { AiProviderError, AppError } from "../../shared/errors.ts";
import { AiChatService } from "../../features/ai_chat/ai_chat.service.ts";
import { AiSessionService } from "../../features/ai_chat/ai_session.service.ts";
import { ConfirmPolicySchema } from "../../features/document_processing/confirm_policy.service.ts";
import { QUICK_NOTE_MAX_LENGTH } from "../../features/document_processing/knowledge_ingestion.service.ts";
import { PolicyIngestionOrchestrator } from "../../features/document_processing/policy_ingestion_orchestrator.ts";
import { compensateIngestionFailure } from "../../shared/ingestion_compensation.ts";
import { UsageService } from "../../modules/subscription/usage.service.ts";
import { StorageService } from "../../modules/storage/storage.service.ts";
import { resolveTimezone } from "../../shared/datetime.ts";
import { AI_BACKEND_NAME, AI_MODEL } from "../../shared/config.ts";
import {
  AiChatSchema,
  AiIngestFileSchema,
  AiIngestPolicySchema,
  AiIngestTextSchema,
  NOTE_MAX_LENGTH,
  AiProcessDocumentRequestSchema,
  AiResolveContactMismatchSchema,
} from "../../features/ai_chat/ai.dto.ts";
export class AiController {
  static async chat(c: Context) {
    const agentId: string = c.get("agent_id");
    const { message, sessionId, context } = AiController.parseChatBody(await c.req.json());

    const usageService = c.get("usage_service") as UsageService;
    await usageService.checkAndIncrementChat(agentId);

    try {
      const timezone = resolveTimezone(c.req.header("x-timezone"), c.req.header("x-timezone-offset"));
      const service: AiChatService = c.get("services").aiChatService;
      const response = await service.processMessage(message, agentId, sessionId, timezone, context, "chat");
      return sendSuccess(c, { ...response, aiBackend: AI_BACKEND_NAME });
    } catch (err) {
      if (err instanceof AiProviderError) {
        // Session already marked inside processMessage; only decrement usage
        await usageService.decrementChat(agentId);
      }
      throw err;
    }
  }

  private static parseChatBody(body: unknown) {
    // Schema.parse: el ZodError lo formatea el globalErrorHandler (RULES §2).
    const parsed = AiChatSchema.parse(body);
    return { message: parsed.message, sessionId: parsed.sessionId, context: parsed.context };
  }

  static async cancelSession(c: Context) {
    const sessionId = c.req.param("sessionId");
    if (!sessionId) throw new AppError("El parámetro 'sessionId' es requerido.", 400);

    const { aiChatService, aiSessionService, embeddingsService } = c.get("services");
    const agentId: string = c.get("agent_id");

    // Si era una sesión de ingesta con duplicado pendiente, soft-delete la nota huérfana
    const meta = await (aiSessionService as AiSessionService).getSessionMetadata(sessionId);
    if (meta?.status === 'duplicate_detected' && meta?.newNoteId) {
      await embeddingsService.softDeleteNoteById(agentId, meta.newNoteId as string, 'session_cancelled');
    }

    const result = await (aiChatService as AiChatService).cancelSession(sessionId);
    return sendSuccess(c, { cancelled: true, ...result });
  }

  static async processDocument(c: Context) {
    const agentId: string = c.get("agent_id");
    const { filePath, fileName } = AiProcessDocumentRequestSchema.parse(await c.req.json());
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
    const body = await c.req.json();
    const { storagePath, fileName, mimeType, contactId } = AiIngestPolicySchema.parse(body);

    const orchestrator = c.get("services").policyIngestionOrchestrator as PolicyIngestionOrchestrator;
    const result = await orchestrator.ingestPolicy(agentId, { storagePath, fileName, mimeType, contactId });

    if (result.status === "contact_mismatch") {
      // No arrancamos el chat de confirmación todavía — se pausa hasta que
      // el asesor resuelva vía /resolve-contact-mismatch (sin costo de IA extra).
      return sendSuccess(c, {
        sessionId: result.sessionId,
        status: "contact_mismatch",
        contactMismatch: result.contactMismatch,
      }, 201);
    }

    return sendSuccess(c, {
      sessionId: result.sessionId,
      message: result.message,
      documentMetadataId: result.documentMetadataId,
      extraction: result.extraction,
      isDuplicate: result.isDuplicate,
    }, 201);
  }

  // Resuelve la pregunta sí/no de contact_mismatch — ver
  // PolicyIngestionOrchestrator.resolveContactMismatch.
  static async resolveContactMismatch(c: Context) {
    const sessionId = c.req.param("sessionId");
    if (!sessionId) throw new AppError("El parámetro 'sessionId' es requerido.", 400);

    const agentId: string = c.get("agent_id");
    const parsed = AiResolveContactMismatchSchema.parse(await c.req.json());

    const orchestrator = c.get("services").policyIngestionOrchestrator as PolicyIngestionOrchestrator;
    const result = await orchestrator.resolveContactMismatch(agentId, sessionId, parsed.assignToScreenContact);

    return sendSuccess(c, result);
  }

  static async ingest(c: Context) {
    const agentId: string = c.get("agent_id");
    const usageService = c.get("usage_service") as UsageService;
    await usageService.checkAndIncrementIngestion(agentId);

    const body = await c.req.json();
    const { storagePath, fileName, mimeType, contactId, policyId, reminderId, makeGeneral } = AiIngestFileSchema.parse(body);

    const storageService = c.get("storage_service") as StorageService;
    storageService.validateMimeType(mimeType);

    const advisorLocale = c.req.header('Accept-Language')?.split(',')[0]?.split(';')[0]?.trim() ?? 'es';

    const { aiSessionService, knowledgeIngestionService } = c.get("services");
    const sessionId = await (aiSessionService as AiSessionService).createSession(agentId, {
      triggerMessage: "file_ingestion",
      sessionType: "knowledge_ingestion",
      modelName: AI_MODEL,
    });
    try {
      const { noteId, responseMessage } = await knowledgeIngestionService.ingestFile(agentId, sessionId, {
        storagePath, fileName, mimeType, contactId, policyId, reminderId, makeGeneral, advisorLocale,
      });
      return sendSuccess(c, {
        noteId,
        sessionId,
        message: responseMessage,
      }, 201);
    } catch (err) {
      await compensateIngestionFailure(err, aiSessionService, usageService, agentId, sessionId);
      throw err;
    }
  }

  static async ingestText(c: Context) {
    const agentId: string = c.get("agent_id");
    const usageService = c.get("usage_service") as UsageService;

    const body = await c.req.json();
    // Antes del parse para poder dar un errorCode propio: un ZodError se aplana
    // a VALIDATION_FAILED con "Datos de entrada inválidos", que no le dice al
    // asesor qué hacer con su nota.
    if (typeof body?.content === "string" && body.content.length > NOTE_MAX_LENGTH) {
      throw new AppError(
        "La nota excede el máximo de caracteres.",
        422,
        "NOTE_TOO_LONG",
      );
    }

    const { content, sourceType, contactId, policyId, reminderId, makeGeneral, isClientNote } = AiIngestTextSchema.parse(body);

    // Solo las notas rápidas de cliente (isClientNote) se libran de la cuota
    // cuando el texto es corto (ver QUICK_NOTE_MAX_LENGTH) — el pegado de
    // texto general en Feed siempre consume cuota, sin importar el tamaño.
    const chargedIngestion = !(isClientNote && content.length <= QUICK_NOTE_MAX_LENGTH);
    if (chargedIngestion) {
      await usageService.checkAndIncrementIngestion(agentId);
    }

    const advisorLocale = c.req.header('Accept-Language')?.split(',')[0]?.split(';')[0]?.trim() ?? 'es';

    const { aiSessionService, knowledgeIngestionService } = c.get("services");
    const sessionId = await (aiSessionService as AiSessionService).createSession(agentId, {
      triggerMessage: "text_ingestion",
      sessionType: "knowledge_ingestion",
      modelName: AI_MODEL,
    });
    try {
      const { noteId, responseMessage } = await knowledgeIngestionService.ingestText(agentId, sessionId, {
        content, sourceType, contactId, policyId, reminderId, makeGeneral, advisorLocale,
      });
      return sendSuccess(c, {
        noteId,
        sessionId,
        message: responseMessage,
      }, 201);
    } catch (err) {
      await compensateIngestionFailure(err, aiSessionService, usageService, agentId, sessionId, chargedIngestion);
      throw err;
    }
  }

  static async confirmPolicy(c: Context) {
    const agentId: string = c.get("agent_id");
    const body = await c.req.json();

    const parsed = ConfirmPolicySchema.parse(body);

    const result = await c.get("services").confirmPolicyService.confirm(agentId, parsed);
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
