import { Context, Next } from "hono";
import { SupabaseClient } from "@supabase/supabase-js";
import { createCatalogServices } from "../../../modules/catalog/catalog.service.ts";
import { ContactService } from "../../../modules/contact/contact.service.ts";
import { ContactRepository } from "../../../modules/contact/contact.repository.ts";
import { PolicyService } from "../../../modules/policy/policy.service.ts";
import { PolicyRepository } from "../../../modules/policy/policy.repository.ts";
import { ReminderService } from "../../../modules/reminder/reminder.service.ts";
import { GeminiProvider } from "../../../providers/gemini.provider.ts";
import { VertexAiProvider } from "../../../providers/vertex_ai.provider.ts";
import { GeminiEmbeddingProvider } from "../../../providers/gemini_embedding.provider.ts";
import { EmbeddingsService } from "../../../features/rag/embeddings.service.ts";
import { RagService } from "../../../features/rag/rag.service.ts";
import { AiChatService } from "../../../features/ai_chat/ai_chat.service.ts";
import { DocumentProcessorService } from "../../../features/document_processing/document_processor.service.ts";
import { KnowledgeIngestionService } from "../../../features/document_processing/knowledge_ingestion.service.ts";
import { PolicyIngestionService } from "../../../features/document_processing/policy_ingestion.service.ts";
import { AgentService } from "../../../modules/agent/agent.service.ts";
import { SubscriptionService } from "../../../modules/subscription/subscription.service.ts";
import { UsageService } from "../../../modules/subscription/usage.service.ts";
import { StorageService } from "../../../modules/storage/storage.service.ts";
import { AppError } from "../../../shared/errors.ts";

function buildGeminiProvider(): GeminiProvider {
  const apiKey = Deno.env.get("GEMINI_API_KEY");
  if (!apiKey) throw new AppError("GEMINI_API_KEY no configurada.", 500);
  const model = Deno.env.get("GEMINI_MODEL") ?? "gemini-3.1-flash-lite";
  return new GeminiProvider(apiKey, model);
}

function buildVertexProvider(): VertexAiProvider {
  const projectId = Deno.env.get("VERTEX_PROJECT_ID");
  const location = Deno.env.get("VERTEX_LOCATION") ?? "us-central1";
  if (!projectId) throw new AppError("VERTEX_PROJECT_ID no configurado.", 500);
  return new VertexAiProvider(projectId, location);
}

function buildDocProvider(agentPlan: "free" | "pro") {
  if (agentPlan === "pro" && Deno.env.get("VERTEX_PROJECT_ID")) {
    return buildVertexProvider();
  }
  return buildGeminiProvider();
}

export const injectServices = async (c: Context, next: Next) => {
  const supabase: SupabaseClient = c.get("supabase");
  const agentId: string = c.get("agent_id");

  const subscriptionService = new SubscriptionService(supabase);
  const subscriptionInfo = await subscriptionService.getSubscriptionInfo(agentId);
  c.set("plan_limits", subscriptionInfo.plan.limits);
  c.set("subscription_service", subscriptionService);
  c.set("usage_service", new UsageService(supabase));

  const agentPlan: "free" | "pro" = subscriptionInfo.plan.slug === "nuevo" ? "free" : "pro";
  c.set("agent_plan", agentPlan);

  const catalogServices = createCatalogServices(supabase, agentId);
  const agentService = new AgentService(supabase);
  const storageService = new StorageService(supabase);
  c.set("storage_service", storageService);
  const contactService = new ContactService(new ContactRepository(supabase));
  const policyService = new PolicyService(supabase, new PolicyRepository(supabase));
  const reminderService = new ReminderService(supabase);

  const geminiProvider = buildGeminiProvider();
  const embeddingProvider = new GeminiEmbeddingProvider(Deno.env.get("GEMINI_API_KEY")!);
  const embeddingsService = new EmbeddingsService(supabase, embeddingProvider);
  const ragService = new RagService(supabase, embeddingProvider);

  const aiChatService = new AiChatService(supabase, geminiProvider, {
    contactService,
    policyService,
    reminderService,
    ragService,
    catalogServices,
  });

  c.set("services", {
    agentService,
    catalogServices,
    contactService,
    policyService,
    reminderService,
    embeddingsService,
    ragService,
    aiChatService,
    get documentProcessorService() {
      return new DocumentProcessorService(supabase, buildDocProvider(agentPlan), embeddingsService);
    },
    get knowledgeIngestionService() {
      return new KnowledgeIngestionService(supabase, buildDocProvider(agentPlan), embeddingsService, embeddingProvider);
    },
    get policyIngestionService() {
      return new PolicyIngestionService(supabase, buildDocProvider(agentPlan), embeddingsService, embeddingProvider);
    },
  });

  await next();
};
