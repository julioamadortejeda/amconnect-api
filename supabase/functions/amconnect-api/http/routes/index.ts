import { Hono } from "hono";
import { AgentController } from "../controllers/agent.controller.ts";
import { DeviceTokenController } from "../controllers/device_token.controller.ts";
import { ContactController } from "../controllers/contact.controller.ts";
import { PolicyController } from "../controllers/policy.controller.ts";
import { ReminderController } from "../controllers/reminder.controller.ts";
import { AiController } from "../controllers/ai.controller.ts";
import { VoiceChatController } from "../controllers/voice_chat.controller.ts";
import { SubscriptionController } from "../controllers/subscription.controller.ts";
import {
  CarrierController,
  BranchController,
  ProductController,
  CurrencyController,
  PaymentFrequencyController,
  PaymentMethodController,
  PolicyStatusController,
  ParticipantRoleController,
  ReminderTypeController,
  ReminderStatusController,
} from "../controllers/catalog.controller.ts";

export const apiRouter = new Hono();

// ─── Agents ───────────────────────────────────────────────────────────────────
apiRouter.get("/agents/me", AgentController.getMe);
apiRouter.patch("/agents/me", AgentController.updateMe);
apiRouter.post("/agents/device-tokens", DeviceTokenController.registerToken);
apiRouter.delete("/agents/device-tokens", DeviceTokenController.deregisterToken);

// ─── Suscripción ──────────────────────────────────────────────────────────────
apiRouter.get("/subscription", SubscriptionController.getInfo);
apiRouter.get("/subscription/plans", SubscriptionController.getPlans);
apiRouter.post("/subscription/apply-promo", SubscriptionController.applyPromo);

// ─── AI ───────────────────────────────────────────────────────────────────────
apiRouter.post("/ai/upload", AiController.uploadFile);
apiRouter.post("/ai/ingest-policy", AiController.ingestPolicy);
apiRouter.post("/ai/chat", AiController.chat);
apiRouter.post("/ai/sessions/:sessionId/cancel", AiController.cancelSession);
apiRouter.get("/ai/sessions/:sessionId/cost", AiController.getSessionCost);
apiRouter.get("/ai/upload-url", AiController.getUploadUrl);
apiRouter.post("/ai/ingest", AiController.ingest);
apiRouter.post("/ai/ingest-text", AiController.ingestText);
apiRouter.post("/ai/confirm-policy", AiController.confirmPolicy);
apiRouter.post("/ai/rag-search", AiController.ragSearch);
apiRouter.get("/ai/voice", VoiceChatController.connect);
apiRouter.post("/ai/voice/token", VoiceChatController.getToken);
apiRouter.post("/ai/voice/init", VoiceChatController.initSession);
apiRouter.post("/ai/voice/execute-tool", VoiceChatController.executeTool);
apiRouter.post("/ai/voice/save-round", VoiceChatController.saveRound);
// Deprecado — mantener por compatibilidad, redirige internamente a ingest
apiRouter.post("/ai/process-document", AiController.processDocument);

// ─── Contacts ─────────────────────────────────────────────────────────────────
apiRouter.get("/contacts", ContactController.getAll);
apiRouter.get("/contacts/search", ContactController.search);
apiRouter.get("/contacts/:id", ContactController.getById);
apiRouter.get("/contacts/:id/notes", ContactController.getNotes);
apiRouter.get("/notes/recent", ContactController.getRecentNotes);
apiRouter.get("/notes/summary", ContactController.getNotesSummary);
apiRouter.get("/notes/search", ContactController.searchNotes);
apiRouter.post("/contacts", ContactController.create);
apiRouter.patch("/contacts/:id", ContactController.update);
apiRouter.delete("/contacts/:id", ContactController.remove);

// ─── Policies ─────────────────────────────────────────────────────────────────
apiRouter.get("/policies", PolicyController.getAll);
apiRouter.get("/policies/:id", PolicyController.getById);
apiRouter.get("/contacts/:contactId/policies", PolicyController.getByContact);
apiRouter.post("/policies", PolicyController.create);
apiRouter.patch("/policies/:id", PolicyController.update);
apiRouter.delete("/policies/:id", PolicyController.remove);
apiRouter.get("/policies/:id/notes", PolicyController.getNotes);
apiRouter.post("/policies/:id/participants", PolicyController.addParticipant);
apiRouter.post("/policies/:id/beneficiaries", PolicyController.addBeneficiary);
apiRouter.delete("/notes/:id", PolicyController.deleteNote);

// ─── Reminders ────────────────────────────────────────────────────────────────
apiRouter.get("/reminders", ReminderController.getAll);
apiRouter.get("/reminders/upcoming", ReminderController.getUpcoming);
apiRouter.get("/reminders/:id", ReminderController.getById);
apiRouter.post("/reminders", ReminderController.create);
apiRouter.patch("/reminders/:id", ReminderController.update);
apiRouter.patch("/reminders/:id/done", ReminderController.markDone);
apiRouter.delete("/reminders/:id", ReminderController.remove);

// ─── Catálogos por agente (CRUD) ──────────────────────────────────────────────
apiRouter.get("/catalog/carriers", CarrierController.getAll);
apiRouter.get("/catalog/carriers/:id", CarrierController.getById);
apiRouter.post("/catalog/carriers", CarrierController.create);
apiRouter.patch("/catalog/carriers/:id", CarrierController.update);
apiRouter.delete("/catalog/carriers/:id", CarrierController.remove);

apiRouter.get("/catalog/branches", BranchController.getAll);
apiRouter.get("/catalog/branches/:id", BranchController.getById);
apiRouter.post("/catalog/branches", BranchController.create);
apiRouter.patch("/catalog/branches/:id", BranchController.update);
apiRouter.delete("/catalog/branches/:id", BranchController.remove);

apiRouter.get("/catalog/products", ProductController.getAll);
apiRouter.get("/catalog/products/:id", ProductController.getById);
apiRouter.post("/catalog/products", ProductController.create);
apiRouter.patch("/catalog/products/:id", ProductController.update);
apiRouter.delete("/catalog/products/:id", ProductController.remove);

// ─── Catálogos globales (solo lectura) ────────────────────────────────────────
apiRouter.get("/catalog/currencies", CurrencyController.getAll);
apiRouter.get("/catalog/payment-frequencies", PaymentFrequencyController.getAll);
apiRouter.get("/catalog/payment-methods", PaymentMethodController.getAll);
apiRouter.get("/catalog/policy-statuses", PolicyStatusController.getAll);
apiRouter.get("/catalog/participant-roles", ParticipantRoleController.getAll);
apiRouter.get("/catalog/reminder-types", ReminderTypeController.getAll);
apiRouter.get("/catalog/reminder-statuses", ReminderStatusController.getAll);

