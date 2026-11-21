import { Hono } from "hono";
import { AgentController } from "../controllers/agent.controller.ts";
import { DeviceTokenController } from "../controllers/device_token.controller.ts";
import { ContactController } from "../controllers/contact.controller.ts";
import { PolicyController } from "../controllers/policy.controller.ts";
import { ReminderController } from "../controllers/reminder.controller.ts";
import { CommitmentController } from "../controllers/commitment.controller.ts";
import { ReminderSettingController } from "../controllers/reminder_setting.controller.ts";
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

import { validate } from "../middleware/validate.ts";
import {
  CommitmentsQuerySchema,
  ContactIdParamSchema,
  IdParamSchema,
  NotesSearchQuerySchema,
  PaginationQuerySchema,
  ReminderSettingOverrideParamSchema,
  RemindersQuerySchema,
  SessionIdParamSchema,
  UploadUrlQuerySchema,
} from "./route_schemas.ts";

export const apiRouter = new Hono();

// ─── Agents ───────────────────────────────────────────────────────────────────
apiRouter.get("/agents/me", AgentController.getMe);
apiRouter.patch("/agents/me", AgentController.updateMe);
apiRouter.post("/agents/me/privacy-consent", AgentController.acceptPrivacy);
apiRouter.post("/agents/device-tokens", DeviceTokenController.registerToken);
apiRouter.delete("/agents/device-tokens", DeviceTokenController.deregisterToken);

// ─── Suscripción ──────────────────────────────────────────────────────────────
apiRouter.get("/subscription", SubscriptionController.getInfo);
apiRouter.get("/subscription/plans", SubscriptionController.getPlans);
apiRouter.post("/subscription/apply-promo", SubscriptionController.applyPromo);

// ─── AI ───────────────────────────────────────────────────────────────────────
apiRouter.post("/ai/ingest-policy", AiController.ingestPolicy);
apiRouter.post("/ai/chat", AiController.chat);
apiRouter.post("/ai/sessions/:sessionId/cancel", validate("param", SessionIdParamSchema), AiController.cancelSession);
apiRouter.post("/ai/sessions/:sessionId/resolve-contact-mismatch", validate("param", SessionIdParamSchema), AiController.resolveContactMismatch);
apiRouter.get("/ai/sessions/:sessionId/cost", validate("param", SessionIdParamSchema), AiController.getSessionCost);
apiRouter.get("/ai/upload-url", validate("query", UploadUrlQuerySchema), AiController.getUploadUrl);
apiRouter.post("/ai/ingest", AiController.ingest);
apiRouter.post("/ai/ingest-text", AiController.ingestText);
apiRouter.post("/ai/confirm-policy", AiController.confirmPolicy);
apiRouter.get("/ai/voice", VoiceChatController.connect);
apiRouter.post("/ai/voice/token", VoiceChatController.getToken);
apiRouter.post("/ai/voice/init", VoiceChatController.initSession);
apiRouter.post("/ai/voice/init-session", VoiceChatController.initSessionWithToken);
apiRouter.post("/ai/voice/execute-tool", VoiceChatController.executeTool);
apiRouter.post("/ai/voice/save-round", VoiceChatController.saveRound);

// ─── Contacts ─────────────────────────────────────────────────────────────────
apiRouter.get("/contacts", validate("query", PaginationQuerySchema), ContactController.getAll);
apiRouter.get("/contacts/:id", validate("param", IdParamSchema), ContactController.getById);
apiRouter.get("/contacts/:id/notes", validate("param", IdParamSchema), validate("query", PaginationQuerySchema), ContactController.getNotes);
apiRouter.get("/notes/summary", ContactController.getNotesSummary);
apiRouter.get("/notes/search", validate("query", NotesSearchQuerySchema), ContactController.searchNotes);
apiRouter.post("/contacts", ContactController.create);
apiRouter.patch("/contacts/:id", validate("param", IdParamSchema), ContactController.update);
apiRouter.delete("/contacts/:id", validate("param", IdParamSchema), ContactController.remove);

// ─── Policies ─────────────────────────────────────────────────────────────────
apiRouter.get("/policies", validate("query", PaginationQuerySchema), PolicyController.getAll);
apiRouter.get("/policies/:id", validate("param", IdParamSchema), PolicyController.getById);
apiRouter.get("/contacts/:contactId/policies", validate("param", ContactIdParamSchema), validate("query", PaginationQuerySchema), PolicyController.getByContact);
apiRouter.post("/policies", PolicyController.create);
apiRouter.patch("/policies/:id", validate("param", IdParamSchema), PolicyController.update);
apiRouter.delete("/policies/:id", validate("param", IdParamSchema), PolicyController.remove);
apiRouter.get("/policies/:id/notes", validate("param", IdParamSchema), validate("query", PaginationQuerySchema), PolicyController.getNotes);
apiRouter.post("/policies/:id/notes", validate("param", IdParamSchema), PolicyController.addNote);
apiRouter.post("/policies/:id/participants", validate("param", IdParamSchema), PolicyController.addParticipant);
apiRouter.post("/policies/:id/beneficiaries", validate("param", IdParamSchema), PolicyController.addBeneficiary);
apiRouter.delete("/notes/:id", validate("param", IdParamSchema), PolicyController.deleteNote);

// ─── Reminders ────────────────────────────────────────────────────────────────
// Compromisos: lo que quedó pendiente con cada cliente, extraído de las notas.
apiRouter.get("/commitments", validate("query", CommitmentsQuerySchema), CommitmentController.getAll);
apiRouter.patch("/commitments/:id/close", validate("param", IdParamSchema), CommitmentController.close);

apiRouter.get("/reminders", validate("query", RemindersQuerySchema), ReminderController.getAll);
// Antes de /reminders/:id — si no, "settings" se leería como un id.
apiRouter.get("/reminders/settings", ReminderSettingController.getAll);
apiRouter.patch("/reminders/settings", ReminderSettingController.update);
apiRouter.delete("/reminders/settings/:typeCode/branches/:branchId", validate("param", ReminderSettingOverrideParamSchema), ReminderSettingController.removeOverride);
apiRouter.get("/reminders/:id", validate("param", IdParamSchema), ReminderController.getById);
apiRouter.post("/reminders", ReminderController.create);
apiRouter.patch("/reminders/:id", validate("param", IdParamSchema), ReminderController.update);
apiRouter.patch("/reminders/:id/done", validate("param", IdParamSchema), ReminderController.markDone);
apiRouter.delete("/reminders/:id", validate("param", IdParamSchema), ReminderController.remove);
apiRouter.get("/reminders/:id/notes", validate("param", IdParamSchema), validate("query", PaginationQuerySchema), ReminderController.getNotes);

// ─── Catálogos por agente (CRUD) ──────────────────────────────────────────────
apiRouter.get("/catalog/carriers", CarrierController.getAll);
apiRouter.get("/catalog/carriers/:id", validate("param", IdParamSchema), CarrierController.getById);
apiRouter.post("/catalog/carriers", CarrierController.create);
apiRouter.patch("/catalog/carriers/:id", validate("param", IdParamSchema), CarrierController.update);
apiRouter.delete("/catalog/carriers/:id", validate("param", IdParamSchema), CarrierController.remove);

apiRouter.get("/catalog/branches", BranchController.getAll);
apiRouter.get("/catalog/branches/:id", validate("param", IdParamSchema), BranchController.getById);
apiRouter.post("/catalog/branches", BranchController.create);
apiRouter.patch("/catalog/branches/:id", validate("param", IdParamSchema), BranchController.update);
apiRouter.delete("/catalog/branches/:id", validate("param", IdParamSchema), BranchController.remove);

apiRouter.get("/catalog/products", ProductController.getAll);
apiRouter.get("/catalog/products/:id", validate("param", IdParamSchema), ProductController.getById);
apiRouter.post("/catalog/products", ProductController.create);
apiRouter.patch("/catalog/products/:id", validate("param", IdParamSchema), ProductController.update);
apiRouter.delete("/catalog/products/:id", validate("param", IdParamSchema), ProductController.remove);

// ─── Catálogos globales (solo lectura) ────────────────────────────────────────
apiRouter.get("/catalog/currencies", CurrencyController.getAll);
apiRouter.get("/catalog/payment-frequencies", PaymentFrequencyController.getAll);
apiRouter.get("/catalog/payment-methods", PaymentMethodController.getAll);
apiRouter.get("/catalog/policy-statuses", PolicyStatusController.getAll);
apiRouter.get("/catalog/participant-roles", ParticipantRoleController.getAll);
apiRouter.get("/catalog/reminder-types", ReminderTypeController.getAll);
apiRouter.get("/catalog/reminder-statuses", ReminderStatusController.getAll);

