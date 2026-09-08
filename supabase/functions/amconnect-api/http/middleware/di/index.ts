import { Context, Next } from "hono";
import { SupabaseClient } from "@supabase/supabase-js";
import { createCatalogServices } from "../../../modules/catalog/catalog.service.ts";
import { ContactService } from "../../../modules/contact/contact.service.ts";
import { ContactRepository } from "../../../modules/contact/contact.repository.ts";
import { PolicyService } from "../../../modules/policy/policy.service.ts";
import { PolicyRepository } from "../../../modules/policy/policy.repository.ts";
import { ReminderService } from "../../../modules/reminder/reminder.service.ts";
import { ReminderRepository } from "../../../modules/reminder/reminder.repository.ts";
import { ReminderGenerationService } from "../../../modules/reminder/reminder_generation.service.ts";
import { ReminderGenerationRepository } from "../../../modules/reminder/reminder_generation.repository.ts";
import { DEFAULT_TIMEZONE, resolveTimezone } from "../../../shared/datetime.ts";
import { ReminderSettingService } from "../../../modules/reminder/reminder_setting.service.ts";
import { ReminderSettingRepository } from "../../../modules/reminder/reminder_setting.repository.ts";
import { AgentService } from "../../../modules/agent/agent.service.ts";
import { AgentRepository } from "../../../modules/agent/agent.repository.ts";
import { DeviceTokenRepository } from "../../../modules/agent/device_token.repository.ts";
import { DeviceTokenService } from "../../../modules/agent/device_token.service.ts";
import { NotificationService } from "../../../features/notification/notification.service.ts";
import { SubscriptionService } from "../../../modules/subscription/subscription.service.ts";
import { SubscriptionRepository } from "../../../modules/subscription/subscription.repository.ts";
import { UsageService } from "../../../modules/subscription/usage.service.ts";
import { UsageRepository } from "../../../modules/subscription/usage.repository.ts";
import { StorageService } from "../../../modules/storage/storage.service.ts";
import { StorageRepository } from "../../../modules/storage/storage.repository.ts";
import { GoogleGenAiProvider } from "../../../providers/google_genai.provider.ts";
import { GeminiProvider } from "../../../providers/gemini.provider.ts";
import { VoiceChatService } from "../../../features/ai_chat/voice_chat.service.ts";
import { EMBEDDING_MODEL, LIVE_AUDIO_MODEL } from "../../../shared/config.ts";
import { VertexAiProvider } from "../../../providers/vertex_ai.provider.ts";
import { GeminiEmbeddingProvider } from "../../../providers/gemini_embedding.provider.ts";
import { EmbeddingsService } from "../../../features/rag/embeddings.service.ts";
import { EmbeddingsRepository } from "../../../features/rag/embeddings.repository.ts";
import { RagService } from "../../../features/rag/rag.service.ts";
import { RagRepository } from "../../../features/rag/rag.repository.ts";
import { AiChatService } from "../../../features/ai_chat/ai_chat.service.ts";
import { AiSessionService } from "../../../features/ai_chat/ai_session.service.ts";
import { AiSessionRepository } from "../../../features/ai_chat/ai_session.repository.ts";
import { TextSplitter } from "../../../shared/text_splitter.ts";
import { DocumentProcessorService } from "../../../features/document_processing/document_processor.service.ts";
import { KnowledgeIngestionService } from "../../../features/document_processing/knowledge_ingestion.service.ts";
import { PolicyIngestionService } from "../../../features/document_processing/policy_ingestion.service.ts";
import { PolicyIngestionOrchestrator } from "../../../features/document_processing/policy_ingestion_orchestrator.ts";
import { ConfirmPolicyService } from "../../../features/document_processing/confirm_policy.service.ts";
import { DocumentMetadataRepository } from "../../../modules/document_metadata/document_metadata.repository.ts";
import { AppError } from "../../../shared/errors.ts";
import { AI_MODEL } from "../../../shared/config.ts";
import { PromptService } from "../../../modules/prompt/prompt.service.ts";
import { NoteRepository } from "../../../modules/note/note.repository.ts";
import { NoteService } from "../../../modules/note/note.service.ts";
import { CommitmentService } from "../../../features/commitments/commitment.service.ts";
import { CommitmentRepository } from "../../../features/commitments/commitment.repository.ts";

// Switch único gratis ↔ pago: AI_BACKEND=studio (default, Gemini API con
// GEMINI_API_KEY) | vertex (Vertex AI con VERTEX_API_KEY). Aplica a chat,
// documentos, embeddings y voz. En vertex la voz usa el WebSocket de Vertex
// Live con token OAuth de la service account (región VERTEX_LIVE_LOCATION,
// default us-central1); en studio usa tokens efímeros v1alpha.
function useVertexBackend(): boolean {
  return Deno.env.get("AI_BACKEND")?.trim().toLowerCase() === "vertex";
}

function getBackendApiKey(): string {
  if (useVertexBackend()) {
    // Sin fallback a GEMINI_API_KEY: una key de AI Studio no sirve en Vertex
    // y produciría 401s confusos en runtime — mejor fallar claro al arrancar.
    const apiKey = Deno.env.get("VERTEX_API_KEY");
    if (!apiKey) throw new AppError("AI_BACKEND=vertex pero VERTEX_API_KEY no está configurada.", 500);
    return apiKey;
  }
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new AppError("GEMINI_API_KEY no configurada.", 500);
  return apiKey;
}

function buildAiProvider(promptService: PromptService): GoogleGenAiProvider {
  const apiKey = getBackendApiKey();
  return useVertexBackend()
    ? new VertexAiProvider(apiKey, AI_MODEL, promptService)
    : new GeminiProvider(apiKey, AI_MODEL, promptService);
}

// Los modelos de env DEBEN existir y estar activos en ai_models (catálogo de
// precios): las FKs de ai_sessions/tokens_usage rechazarían la sesión y los
// costos se calcularían mal. Se valida una vez por isolate al primer request.
let modelCatalogChecked = false;
async function checkModelCatalog(supabase: SupabaseClient): Promise<void> {
  if (modelCatalogChecked) return;
  const required = [...new Set([AI_MODEL, LIVE_AUDIO_MODEL, EMBEDDING_MODEL])];
  const { data, error } = await supabase
    .from("ai_models")
    .select("model_name")
    .in("model_name", required)
    .eq("is_active", true);
  if (error) throw new AppError("No se pudo validar el catálogo de modelos (ai_models).", 500);
  const found = new Set((data ?? []).map((r: { model_name: string }) => r.model_name));
  const missing = required.filter((m) => !found.has(m));
  if (missing.length > 0) {
    throw new AppError(
      `Modelos configurados sin fila activa en ai_models: ${missing.join(", ")}. Agrégalos al catálogo (migración) o corrige el env.`,
      500,
    );
  }
  modelCatalogChecked = true;
}

export const injectServices = async (c: Context, next: Next) => {
  const supabase: SupabaseClient = c.get("supabase");
  const agentId: string = c.get("agent_id");

  await checkModelCatalog(supabase);

  // Usage + Subscription
  const usageRepository = new UsageRepository(supabase);
  const usageService = new UsageService(usageRepository);

  const subscriptionRepository = new SubscriptionRepository(supabase);
  const subscriptionService = new SubscriptionService(subscriptionRepository, usageService);

  const agentStatus = await subscriptionService.checkSubscriptionActive(agentId);
  c.set("subscription_service", subscriptionService);
  c.set("usage_service", usageService);

  // Core modules
  const catalogServices = createCatalogServices(supabase, agentId);
  const agentService = new AgentService(new AgentRepository(supabase));

  // La zona horaria viaja en cada request, pero el cron diario de recordatorios
  // no tiene request del cual leerla: se persiste aquí cuando cambia (sin query
  // extra — el estado del agente ya se leyó arriba). Fire-and-forget a propósito:
  // que falle guardar la zona no puede tumbar la petición del asesor.
  // OJO: solo se persiste si el cliente REALMENTE mandó header. resolveTimezone()
  // rellena con DEFAULT_TIMEZONE cuando no hay nada, así que guardar su resultado
  // a ciegas haría que un cliente sin header (la futura web, un webhook, un curl)
  // pisara el "Europe/Madrid" correcto con "America/Mexico_City".
  const timezoneHeader = c.req.header("x-timezone");
  const offsetHeader = c.req.header("x-timezone-offset");
  const clientTimezone = (timezoneHeader || offsetHeader)
    ? resolveTimezone(timezoneHeader, offsetHeader)
    : null;

  if (clientTimezone && clientTimezone !== agentStatus.timezone) {
    agentService.syncTimezone(agentId, clientTimezone).catch((error) => {
      console.error("[DI] no se pudo guardar el timezone del asesor:", error?.message ?? error);
    });
  }

  // Para este request: lo que reportó el cliente, si no lo último que guardamos.
  const reportedTimezone = clientTimezone ?? agentStatus.timezone ?? DEFAULT_TIMEZONE;
  const deviceTokenRepository = new DeviceTokenRepository(supabase);
  const deviceTokenService = new DeviceTokenService(deviceTokenRepository, subscriptionRepository);
  const notificationService = new NotificationService(deviceTokenRepository, new ReminderRepository(supabase));
  const promptService = new PromptService(supabase);
  const storageService = new StorageService(new StorageRepository(supabase));
  c.set("storage_service", storageService);

  const contactService = new ContactService(new ContactRepository(supabase));
  const policyService = new PolicyService(supabase, new PolicyRepository(supabase), reportedTimezone);
  const noteService = new NoteService(new NoteRepository(supabase));
  const commitmentService = new CommitmentService(new CommitmentRepository(supabase));
  const reminderService = new ReminderService(new ReminderRepository(supabase));
  const reminderSettingService = new ReminderSettingService(
    new ReminderSettingRepository(supabase),
    agentId,
  );
  const reminderGenerationService = new ReminderGenerationService(
    new ReminderGenerationRepository(supabase),
    reminderSettingService,
  );

  // AI infrastructure (instanciados de forma perezosa / lazy loaded)
  let geminiProvider: GoogleGenAiProvider | undefined;
  let embeddingProvider: GeminiEmbeddingProvider | undefined;
  let embeddingsService: EmbeddingsService | undefined;
  let ragService: RagService | undefined;
  let aiChatService: AiChatService | undefined;
  let voiceChatService: VoiceChatService | undefined;
  let docProvider: GoogleGenAiProvider | undefined;
  let documentProcessorService: DocumentProcessorService | undefined;
  let knowledgeIngestionService: KnowledgeIngestionService | undefined;
  let policyIngestionService: PolicyIngestionService | undefined;
  let policyIngestionOrchestrator: PolicyIngestionOrchestrator | undefined;
  let confirmPolicyService: ConfirmPolicyService | undefined;

  const getGeminiProvider = () => {
    if (!geminiProvider) geminiProvider = buildAiProvider(promptService);
    return geminiProvider;
  };

  const getEmbeddingProvider = () => {
    if (!embeddingProvider) {
      embeddingProvider = new GeminiEmbeddingProvider(getBackendApiKey(), 768, useVertexBackend());
    }
    return embeddingProvider;
  };

  const getEmbeddingsService = () => {
    if (!embeddingsService) {
      embeddingsService = new EmbeddingsService(
        new EmbeddingsRepository(supabase),
        getEmbeddingProvider(),
        textSplitter,
      );
    }
    return embeddingsService;
  };

  const getRagService = () => {
    if (!ragService) {
      ragService = new RagService(new RagRepository(supabase), getEmbeddingProvider());
    }
    return ragService;
  };

  const getAiChatService = () => {
    if (!aiChatService) {
      aiChatService = new AiChatService(
        getGeminiProvider(),
        {
          contactService,
          knowledgeIngestionService: getKnowledgeIngestionService(),
          usageService,
          policyService,
          reminderService,
          reminderGenerationService,
          reminderSettingService,
          ragService: getRagService(),
          commitmentService,
          embeddingsService: getEmbeddingsService(),
          catalogServices,
        },
        aiSessionService,
        promptService,
      );
    }
    return aiChatService;
  };

  const getVoiceChatService = () => {
    if (!voiceChatService) {
      voiceChatService = new VoiceChatService(
        getGeminiProvider(),
        {
          contactService,
          knowledgeIngestionService: getKnowledgeIngestionService(),
          usageService,
          policyService,
          reminderService,
          reminderGenerationService,
          reminderSettingService,
          ragService: getRagService(),
          commitmentService,
          embeddingsService: getEmbeddingsService(),
          catalogServices,
        },
        aiSessionService,
        promptService,
        usageService,
      );
    }
    return voiceChatService;
  };

  const getDocProvider = () => {
    if (!docProvider) docProvider = buildAiProvider(promptService);
    return docProvider;
  };

  const getDocumentProcessorService = () => {
    if (!documentProcessorService) {
      documentProcessorService = new DocumentProcessorService(storageService, documentMetadataRepository, getDocProvider(), getEmbeddingsService(), promptService);
    }
    return documentProcessorService;
  };

  const getKnowledgeIngestionService = () => {
    if (!knowledgeIngestionService) {
      knowledgeIngestionService = new KnowledgeIngestionService(documentMetadataRepository, getDocProvider(), getEmbeddingsService(), getEmbeddingProvider(), aiSessionService, storageService, promptService);
    }
    return knowledgeIngestionService;
  };

  const getPolicyIngestionService = () => {
    if (!policyIngestionService) {
      policyIngestionService = new PolicyIngestionService(
        documentMetadataRepository,
        getDocProvider(),
        getEmbeddingsService(),
        getEmbeddingProvider(),
        aiSessionService,
        storageService,
        policyService,
        catalogServices,
        promptService,
        contactService,
      );
    }
    return policyIngestionService;
  };

  const getPolicyIngestionOrchestrator = () => {
    if (!policyIngestionOrchestrator) {
      policyIngestionOrchestrator = new PolicyIngestionOrchestrator(
        aiSessionService,
        getPolicyIngestionService(),
        getAiChatService(),
        usageService,
      );
    }
    return policyIngestionOrchestrator;
  };

  const getConfirmPolicyService = () => {
    if (!confirmPolicyService) {
      confirmPolicyService = new ConfirmPolicyService(policyService, getEmbeddingsService());
    }
    return confirmPolicyService;
  };

  const textSplitter = new TextSplitter();
  const aiSessionService = new AiSessionService(new AiSessionRepository(supabase));
  const documentMetadataRepository = new DocumentMetadataRepository(supabase);

  c.set("services", {
    agentService,
    deviceTokenService,
    notificationService,
    catalogServices,
    contactService,
    policyService,
    noteService,
    commitmentService,
    reminderService,
    reminderSettingService,
    reminderGenerationService,
    aiSessionService,
    promptService,
    get embeddingsService() {
      return getEmbeddingsService();
    },
    get ragService() {
      return getRagService();
    },
    get aiChatService() {
      return getAiChatService();
    },
    get documentProcessorService() {
      return getDocumentProcessorService();
    },
    get knowledgeIngestionService() {
      return getKnowledgeIngestionService();
    },
    get policyIngestionService() {
      return getPolicyIngestionService();
    },
    get policyIngestionOrchestrator() {
      return getPolicyIngestionOrchestrator();
    },
    get confirmPolicyService() {
      return getConfirmPolicyService();
    },
    get voiceChatService() {
      return getVoiceChatService();
    },
  });

  await next();
};
