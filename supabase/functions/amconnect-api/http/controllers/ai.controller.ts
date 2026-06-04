import { Context } from "hono";
import { sendSuccess } from "../../shared/api_response.ts";
import { AppError } from "../../shared/errors.ts";
import { AiChatService } from "../../features/ai_chat/ai_chat.service.ts";
import { DocumentProcessorService } from "../../features/document_processing/document_processor.service.ts";
import { ConfirmPolicySchema, ConfirmPolicyService } from "../../features/document_processing/confirm_policy.service.ts";

export class AiController {
  static async chat(c: Context) {
    const agentId: string = c.get("agent_id");
    const { message, sessionId: session_id } = await c.req.json();

    if (!message) throw new AppError("El campo 'message' es requerido.", 400);

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
    const agentPlan: "free" | "pro" = c.get("agent_plan");
    const { filePath, fileName } = await c.req.json();

    if (!filePath || !fileName) {
      throw new AppError("Los campos 'filePath' y 'fileName' son requeridos.", 400);
    }

    const service: DocumentProcessorService = c.get("services").documentProcessorService;
    const result = await service.processDocument(agentId, filePath, fileName, agentPlan);

    return sendSuccess(c, result);
  }

  static async getUploadUrl(c: Context) {
    const agentId: string = c.get("agent_id");
    const agentPlan: "free" | "pro" = c.get("agent_plan");

    if (agentPlan === "free") {
      throw new AppError("El procesamiento de pólizas PDF está disponible solo en el plan Pro.", 403);
    }

    const fileName = c.req.query("fileName");
    if (!fileName) throw new AppError("Se requiere el parámetro 'fileName'.", 400);

    const safeName = fileName.replace(/[^a-zA-Z0-9._-]/g, "_");
    const storagePath = `${agentId}/${Date.now()}-${safeName}`;

    const supabase = c.get("supabase");
    const { data, error } = await supabase.storage
      .from("policies")
      .createSignedUploadUrl(storagePath);

    if (error || !data) {
      throw new AppError(`No se pudo generar la URL de carga: ${error?.message}`, 500);
    }

    return sendSuccess(c, {
      uploadUrl: data.signedUrl,
      storagePath,
      token: data.token,
    });
  }

  static async confirmPolicy(c: Context) {
    const agentId: string = c.get("agent_id");
    const body = await c.req.json();

    const parsed = ConfirmPolicySchema.safeParse(body);
    if (!parsed.success) {
      const issues = parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ");
      throw new AppError(`Datos inválidos: ${issues}`, 400);
    }

    const { policyService } = c.get("services");
    const supabase = c.get("supabase");
    const service = new ConfirmPolicyService(supabase, policyService);
    const result = await service.confirm(agentId, parsed.data);

    return sendSuccess(c, result);
  }
}
