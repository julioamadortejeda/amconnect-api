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
import { AgentService } from "../../../modules/agent/agent.service.ts";
import { AgentRepository } from "../../../modules/agent/agent.repository.ts";
import { SubscriptionService } from "../../../modules/subscription/subscription.service.ts";
import { SubscriptionRepository } from "../../../modules/subscription/subscription.repository.ts";
import { UsageService } from "../../../modules/subscription/usage.service.ts";
import { UsageRepository } from "../../../modules/subscription/usage.repository.ts";
import { StorageService } from "../../../modules/storage/storage.service.ts";
import { StorageRepository } from "../../../modules/storage/storage.repository.ts";
import { GeminiProvider } from "../../../providers/gemini.provider.ts";
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
import { ConfirmPolicyService } from "../../../features/document_processing/confirm_policy.service.ts";
import { DocumentMetadataRepository } from "../../../modules/document_metadata/document_metadata.repository.ts";
import { AppError } from "../../../shared/errors.ts";
import { AI_MODEL } from "../../../shared/config.ts";
import { PromptService } from "../../../modules/prompt/prompt.service.ts";

function buildGeminiProvider(): GeminiProvider {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new AppError("GEMINI_API_KEY no configurada.", 500);
  const model = AI_MODEL;
  return new GeminiProvider(apiKey, model);
}

function buildVertexProvider(): VertexAiProvider {
  const projectId = Deno.env.get("VERTEX_PROJECT_ID");
  const location = Deno.env.get("VERTEX_LOCATION") ?? "us-central1";
  if (!projectId) throw new AppError("VERTEX_PROJECT_ID no configurado.", 500);
  return new VertexAiProvider(projectId, location, AI_MODEL);
}

function buildDocProvider() {
  if (Deno.env.get("VERTEX_PROJECT_ID")) return buildVertexProvider();
  return buildGeminiProvider();
}

export const injectServices = async (c: Context, next: Next) => {
  const supabase: SupabaseClient = c.get("supabase");
  const agentId: string = c.get("agent_id");

  // Usage + Subscription
  const usageRepository = new UsageRepository(supabase);
  const usageService = new UsageService(usageRepository);

  const subscriptionRepository = new SubscriptionRepository(supabase);
  const subscriptionService = new SubscriptionService(subscriptionRepository, usageService);

  await subscriptionService.checkSubscriptionActive(agentId);
  c.set("subscription_service", subscriptionService);
  c.set("usage_service", usageService);

  // Core modules
  const catalogServices = createCatalogServices(supabase, agentId);
  const agentService = new AgentService(new AgentRepository(supabase));
  const promptService = new PromptService(supabase);
  const storageService = new StorageService(new StorageRepository(supabase));
  c.set("storage_service", storageService);

  const contactService = new ContactService(new ContactRepository(supabase));
  const policyService = new PolicyService(supabase, new PolicyRepository(supabase));
  const reminderService = new ReminderService(new ReminderRepository(supabase));
  const reminderGenerationService = new ReminderGenerationService(new ReminderGenerationRepository(supabase));

  // AI infrastructure (instanciados de forma perezosa / lazy loaded)
  let geminiProvider: GeminiProvider | undefined;
  let embeddingProvider: GeminiEmbeddingProvider | undefined;
  let embeddingsService: EmbeddingsService | undefined;
  let ragService: RagService | undefined;
  let aiChatService: AiChatService | undefined;
  let docProvider: GeminiProvider | VertexAiProvider | undefined;
  let documentProcessorService: DocumentProcessorService | undefined;
  let knowledgeIngestionService: KnowledgeIngestionService | undefined;
  let policyIngestionService: PolicyIngestionService | undefined;
  let confirmPolicyService: ConfirmPolicyService | undefined;

  const getGeminiProvider = () => {
    if (!geminiProvider) geminiProvider = buildGeminiProvider();
    return geminiProvider;
  };

  const getEmbeddingProvider = () => {
    if (!embeddingProvider) {
      const apiKey = Deno.env.get("GEMINI_API_KEY");
      if (!apiKey) throw new AppError("GEMINI_API_KEY no configurada.", 500);
      embeddingProvider = new GeminiEmbeddingProvider(apiKey);
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
          policyService,
          reminderService,
          reminderGenerationService,
          ragService: getRagService(),
          embeddingsService: getEmbeddingsService(),
          catalogServices,
        },
        aiSessionService,
        promptService,
      );
    }
    return aiChatService;
  };

  const getDocProvider = () => {
    if (!docProvider) docProvider = buildDocProvider();
    return docProvider;
  };

  const getDocumentProcessorService = () => {
    if (!documentProcessorService) {
      documentProcessorService = new DocumentProcessorService(storageService, documentMetadataRepository, getDocProvider(), getEmbeddingsService());
    }
    return documentProcessorService;
  };

  const getKnowledgeIngestionService = () => {
    if (!knowledgeIngestionService) {
      knowledgeIngestionService = new KnowledgeIngestionService(documentMetadataRepository, getDocProvider(), getEmbeddingsService(), getEmbeddingProvider(), aiSessionService, storageService);
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
      );
    }
    return policyIngestionService;
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
    catalogServices,
    contactService,
    policyService,
    reminderService,
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
    get confirmPolicyService() {
      return getConfirmPolicyService();
    },
  });

  await next();
};
