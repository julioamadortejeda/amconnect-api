import { Context } from "hono";
import { sendSuccess } from "../../shared/api_response.ts";
import { AppError } from "../../shared/errors.ts";
import { AiChatService } from "../../features/ai_chat/ai_chat.service.ts";
import { ConfirmPolicySchema, ConfirmPolicyService } from "../../features/document_processing/confirm_policy.service.ts";
import { SubscriptionService } from "../../modules/subscription/subscription.service.ts";
import { StorageService } from "../../modules/storage/storage.service.ts";

export class AiController {
  static async chat(c: Context) {
    const agentId: string = c.get("agent_id");
    const { message, sessionId: session_id } = await c.req.json();

    if (!message) throw new AppError("El campo 'message' es requerido.", 400);

    const service: AiChatService = c.get("services").aiChatService;
    const planLimits = c.get("plan_limits");
    const response = await service.processMessage(message, agentId, session_id, planLimits);

    return sendSuccess(c, response);
  }

  static async cancelSession(c: Context) {
    const service: AiChatService = c.get("services").aiChatService;
    const result = await service.cancelSession(c.req.param("sessionId"));
    return sendSuccess(c, { cancelled: true, ...result });
  }

  static async processDocument(c: Context) {
    const agentId: string = c.get("agent_id");
    const agentPlan: "free" | "pro" = c.get("agent_plan");
    const { filePath, fileName } = await c.req.json();

    if (!filePath || !fileName) {
      throw new AppError("Los campos 'filePath' y 'fileName' son requeridos.", 400);
    }

    const service = c.get("services").documentProcessorService;
    const result = await service.processDocument(agentId, filePath, fileName, agentPlan);

    return sendSuccess(c, result);
  }

  static async uploadFile(c: Context) {
    const agentId: string = c.get("agent_id");
    const planLimits = c.get("plan_limits");
    const subscriptionService = c.get("subscription_service") as SubscriptionService;
    await subscriptionService.checkIngestionLimit(agentId, planLimits);

    const formData = await c.req.formData();
    const file = formData.get("file") as File | null;
    if (!file) throw new AppError("Se requiere el archivo en el campo 'file'.", 400);

    const storageService = c.get("storage_service") as StorageService;
    const result = await storageService.upload(agentId, file);

    return sendSuccess(c, result, 201);
  }

  static async getUploadUrl(c: Context) {
    const agentId: string = c.get("agent_id");
    const planLimits = c.get("plan_limits");
    const subscriptionService = c.get("subscription_service") as SubscriptionService;
    await subscriptionService.checkIngestionLimit(agentId, planLimits);

    const fileName = c.req.query("fileName");
    const mimeType = c.req.query("mimeType") ?? "application/pdf";
    if (!fileName) throw new AppError("Se requiere el parámetro 'fileName'.", 400);

    const storageService = c.get("storage_service") as StorageService;
    const result = await storageService.getSignedUploadUrl(agentId, fileName, mimeType);

    return sendSuccess(c, result);
  }

  static async ingestPolicy(c: Context) {
    const agentId: string = c.get("agent_id");
    const planLimits = c.get("plan_limits");
    const subscriptionService = c.get("subscription_service") as SubscriptionService;
    await subscriptionService.checkIngestionLimit(agentId, planLimits);

    const { storagePath, fileName, mimeType, contactId } = await c.req.json();
    if (!storagePath || !fileName || !mimeType) {
      throw new AppError("Se requieren: storagePath, fileName, mimeType.", 400);
    }
    if (mimeType !== "application/pdf") {
      throw new AppError("ingest-policy solo acepta archivos PDF.", 400);
    }

    const { policyIngestionService, aiChatService } = c.get("services");
    const { extraction, documentMetadataId } = await policyIngestionService.extract(agentId, {
      storagePath, fileName, mimeType, contactId,
    });

    const { sessionId, text } = await aiChatService.startPolicySession(
      agentId,
      extraction as unknown as Record<string, unknown>,
      documentMetadataId,
    );

    return sendSuccess(c, { sessionId, message: text, documentMetadataId, extraction }, 201);
  }

  static async ingest(c: Context) {
    const agentId: string = c.get("agent_id");
    const planLimits = c.get("plan_limits");
    const subscriptionService = c.get("subscription_service") as SubscriptionService;
    await subscriptionService.checkIngestionLimit(agentId, planLimits);

    const { storagePath, fileName, mimeType, contactId, policyId } = await c.req.json();
    if (!storagePath || !fileName || !mimeType) {
      throw new AppError("Se requieren: storagePath, fileName, mimeType.", 400);
    }

    const storageService = c.get("storage_service") as StorageService;
    storageService.validateMimeType(mimeType);

    const { knowledgeIngestionService } = c.get("services");
    const result = await knowledgeIngestionService.ingestFile(agentId, {
      storagePath, fileName, mimeType, contactId, policyId,
    });

    return sendSuccess(c, result, 201);
  }

  static async ingestText(c: Context) {
    const agentId: string = c.get("agent_id");
    const planLimits = c.get("plan_limits");
    const subscriptionService = c.get("subscription_service") as SubscriptionService;
    await subscriptionService.checkIngestionLimit(agentId, planLimits);

    const { content, sourceType, contactId, policyId } = await c.req.json();
    if (!content || !sourceType) {
      throw new AppError("Se requieren: content, sourceType ('whatsapp' | 'text').", 400);
    }
    if (!["whatsapp", "text"].includes(sourceType)) {
      throw new AppError("sourceType debe ser 'whatsapp' o 'text'.", 400);
    }

    const { knowledgeIngestionService } = c.get("services");
    const result = await knowledgeIngestionService.ingestText(agentId, {
      content, sourceType, contactId, policyId,
    });

    return sendSuccess(c, result, 201);
  }

  static async confirmPolicy(c: Context) {
    const agentId: string = c.get("agent_id");
    const body = await c.req.json();

    const parsed = ConfirmPolicySchema.safeParse(body);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      throw new AppError(`Datos inválidos: ${issues}`, 400);
    }

    const { policyService, embeddingsService } = c.get("services");
    const supabase = c.get("supabase");
    const service = new ConfirmPolicyService(supabase, policyService, embeddingsService);
    const result = await service.confirm(agentId, parsed.data);

    return sendSuccess(c, result);
  }
}
