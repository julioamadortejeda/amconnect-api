// Qué documentar de cada ruta del `apiRouter` que NO se puede leer del router.
//
// Los params y el query salen solos: son los esquemas que ya pasan por
// `validate()` en `http/routes/index.ts` (ver `validatorMeta`). Aquí solo vive
// lo que los controllers parsean por dentro (el body) y el texto. Un body se
// declara referenciando el MISMO esquema Zod del DTO que el controller usa en
// `X.parse(await c.req.json())`: si el DTO cambia, el documento cambia.
//
// Sin esquema de body/respuesta no se inventa uno: queda un objeto genérico.
// `openapi_test.ts` truena si una ruta del router no tiene entrada aquí.
import type { ZodTypeAny } from "zod";
import { AgentUpdateSchema, PrivacyConsentSchema } from "../../modules/agent/agent.dto.ts";
import { DeviceTokenDeregisterSchema, DeviceTokenRegisterSchema, DeviceTokenResponseSchema } from "../../modules/agent/device_token.dto.ts";
import { BranchSchema, CarrierSchema, ProductSchema } from "../../modules/catalog/catalog.dto.ts";
import { ContactRequestSchema } from "../../modules/contact/contact.dto.ts";
import { BeneficiarySchema, PolicyNoteCreateSchema, PolicyParticipantSchema, PolicyRequestSchema } from "../../modules/policy/policy.dto.ts";
import { ReminderRequestSchema } from "../../modules/reminder/reminder.dto.ts";
import { ReminderSettingRequestSchema } from "../../modules/reminder/reminder_setting.dto.ts";
import { ApplyPromoSchema } from "../../modules/subscription/subscription.dto.ts";
import {
  AiChatSchema,
  AiIngestFileSchema,
  AiIngestPolicySchema,
  AiIngestTextSchema,
  AiResolveContactMismatchSchema,
} from "../../features/ai_chat/ai.dto.ts";
import { ConfirmPolicySchema } from "../../features/document_processing/confirm_policy.service.ts";
import { CloseCommitmentSchema } from "../controllers/commitment.controller.ts";

export interface RouteDoc {
  summary: string;
  /** Esquema del body. Con `partialBody`, el controller lo parsea con `.partial()` (PATCH). */
  body?: ZodTypeAny;
  partialBody?: boolean;
  /** El body es opcional (el controller tolera una petición sin cuerpo). */
  bodyOptional?: boolean;
  /** Esquema del `data` de la respuesta de éxito; sin él, objeto genérico. */
  response?: ZodTypeAny;
  /** La respuesta de éxito es un arreglo (de `response`, o de objetos genéricos). */
  responseIsList?: boolean;
  /** Responde 201 en vez de 200. */
  created?: boolean;
  /** Consume cuota mensual (chat/ingesta) → puede responder 429 QUOTA_EXCEEDED. */
  quota?: boolean;
  /**
   * El éxito es un stream `text/event-stream` (SSE) en vez del sobre JSON;
   * el texto describe los eventos. Los errores ANTES de abrir el stream siguen
   * siendo el sobre JSON con su status.
   */
  eventStream?: string;
  /** No entra al documento (no es REST/JSON). `reason` explica por qué. */
  internal?: { reason: string };
}

/** Eventos de `POST /ai/chat/stream` (fuente: http/sse/chat_stream_writer.ts). */
const CHAT_STREAM_EVENTS = [
  "Stream SSE. Cada evento trae `id` (secuencia 1, 2, 3…) y `data` en JSON:",
  "- `status` `{phase:\"thinking\", sessionId}`: antes de cada llamada al modelo.",
  "- `tool` `{name, label, state:\"started\"|\"finished\", ok?}`: `name` es el código de la herramienta (la app traduce la etiqueta al idioma del teléfono); `label` es la etiqueta en el idioma de la respuesta, de respaldo.",
  "- `delta` `{text}`: texto de la respuesta (hoy llega completo en un solo delta).",
  "- `done`: el mismo `data` que `POST /ai/chat` (`text, sessionId, usage, sessionUsage, metadata, aiBackend`). Último evento.",
  "- `error` `{errorCode, error, errorId?}`: falla con el stream ya abierto (mismos códigos que el JSON). Último evento.",
  "- `cancelled` `{sessionId, modelCalls}`: el turno se detuvo (cliente desconectado o `/ai/sessions/:id/cancel`). Último evento.",
  "Errores antes de abrir el stream (422, 404, 409, 429, 402) llegan como el sobre JSON de siempre.",
].join("\n");

/** Clave: `"METHOD /ruta/:param"` tal cual está registrada en el router. */
export const ROUTE_DOCS: Record<string, RouteDoc> = {
  // ─── Agents
  "GET /agents/me": { summary: "Perfil del asesor autenticado" },
  "PATCH /agents/me": { summary: "Actualiza el perfil del asesor", body: AgentUpdateSchema },
  "POST /agents/me/privacy-consent": { summary: "Registra la aceptación del aviso de privacidad", body: PrivacyConsentSchema },
  "POST /agents/device-tokens": { summary: "Registra el token push de un dispositivo", body: DeviceTokenRegisterSchema, response: DeviceTokenResponseSchema },
  "DELETE /agents/device-tokens": { summary: "Desregistra el token push de un dispositivo", body: DeviceTokenDeregisterSchema },

  // ─── Suscripción
  "GET /subscription": { summary: "Plan, estado y uso del mes del asesor" },
  "GET /subscription/plans": { summary: "Planes disponibles", responseIsList: true },
  "POST /subscription/apply-promo": { summary: "Aplica un código promocional", body: ApplyPromoSchema },

  // ─── AI
  "POST /ai/ingest-policy": { summary: "Extrae una póliza de un PDF o imagen ya subido", body: AiIngestPolicySchema, quota: true, created: true },
  "POST /ai/chat": { summary: "Mensaje de texto al asistente", body: AiChatSchema, quota: true },
  "POST /ai/chat/stream": {
    summary: "Mensaje de texto al asistente, contado en vivo por SSE",
    body: AiChatSchema,
    quota: true,
    eventStream: CHAT_STREAM_EVENTS,
  },
  "POST /ai/sessions/:sessionId/cancel": { summary: "Cancela las tareas pendientes de una sesión del asistente y, si corre en esta instancia, su turno en curso" },
  "POST /ai/sessions/:sessionId/resolve-contact-mismatch": { summary: "Resuelve a qué cliente se asigna una ingesta ambigua", body: AiResolveContactMismatchSchema },
  "GET /ai/sessions/:sessionId/cost": { summary: "Costo de una sesión del asistente" },
  "GET /ai/upload-url": { summary: "URL firmada para subir un archivo a Storage" },
  "POST /ai/ingest": { summary: "Ingesta un archivo al conocimiento del asesor", body: AiIngestFileSchema, quota: true, created: true },
  "POST /ai/ingest-text": { summary: "Ingesta una nota de texto", body: AiIngestTextSchema, quota: true, created: true },
  "POST /ai/confirm-policy": { summary: "Confirma y crea una póliza con IDs ya resueltos", body: ConfirmPolicySchema },
  "GET /ai/voice": { summary: "Canal de voz Live", internal: { reason: "WebSocket (Upgrade), no describible como operación REST/JSON" } },
  // Los bodies de voz se leen con `c.req.json()` sin esquema: objetos genéricos.
  "POST /ai/voice/token": { summary: "Token efímero para la voz Live", bodyOptional: true },
  "POST /ai/voice/init": { summary: "Inicia una sesión de voz", bodyOptional: true },
  "POST /ai/voice/init-session": { summary: "Inicia una sesión de voz con token ya emitido", bodyOptional: true },
  "POST /ai/voice/execute-tool": { summary: "Ejecuta una herramienta del asistente pedida por el modelo de voz" },
  "POST /ai/voice/save-round": { summary: "Guarda una ronda de la conversación de voz" },

  // ─── Contacts
  "GET /contacts": { summary: "Lista paginada de clientes" },
  "GET /contacts/:id": { summary: "Detalle de un cliente" },
  "GET /contacts/:id/notes": { summary: "Notas de un cliente" },
  "GET /notes/summary": { summary: "Resumen de notas" },
  "GET /notes/search": { summary: "Búsqueda de notas" },
  "POST /contacts": { summary: "Crea un cliente", body: ContactRequestSchema, created: true },
  "PATCH /contacts/:id": { summary: "Actualiza un cliente", body: ContactRequestSchema, partialBody: true },
  "DELETE /contacts/:id": { summary: "Da de baja un cliente (soft delete)" },

  // ─── Policies
  "GET /policies": { summary: "Lista paginada de pólizas" },
  "GET /policies/:id": { summary: "Detalle de una póliza" },
  "GET /contacts/:contactId/policies": { summary: "Pólizas de un cliente" },
  "POST /policies": { summary: "Crea una póliza", body: PolicyRequestSchema, created: true },
  "PATCH /policies/:id": { summary: "Actualiza una póliza", body: PolicyRequestSchema, partialBody: true },
  "DELETE /policies/:id": { summary: "Da de baja una póliza (soft delete)" },
  "GET /policies/:id/notes": { summary: "Notas de una póliza" },
  "POST /policies/:id/notes": { summary: "Agrega una nota a una póliza", body: PolicyNoteCreateSchema, created: true },
  "POST /policies/:id/participants": { summary: "Agrega un participante a una póliza", body: PolicyParticipantSchema, created: true },
  "POST /policies/:id/beneficiaries": { summary: "Agrega un beneficiario a una póliza", body: BeneficiarySchema, created: true },
  "DELETE /notes/:id": { summary: "Da de baja una nota" },

  // ─── Compromisos y recordatorios
  "GET /commitments": { summary: "Lista paginada de compromisos con clientes" },
  "PATCH /commitments/:id/close": { summary: "Cierra (cumplido o descartado) un compromiso", body: CloseCommitmentSchema, bodyOptional: true },
  "GET /reminders": { summary: "Lista paginada de recordatorios" },
  "GET /reminders/settings": { summary: "Configuración de avisos del asesor" },
  "PATCH /reminders/settings": { summary: "Actualiza la configuración de avisos", body: ReminderSettingRequestSchema },
  "DELETE /reminders/settings/:typeCode/branches/:branchId": { summary: "Quita el ajuste de avisos de un ramo" },
  "GET /reminders/:id": { summary: "Detalle de un recordatorio" },
  "POST /reminders": { summary: "Crea un recordatorio", body: ReminderRequestSchema, created: true },
  "PATCH /reminders/:id": { summary: "Actualiza un recordatorio", body: ReminderRequestSchema, partialBody: true },
  "PATCH /reminders/:id/done": { summary: "Marca un recordatorio como hecho" },
  "DELETE /reminders/:id": { summary: "Da de baja un recordatorio" },
  "GET /reminders/:id/notes": { summary: "Notas de un recordatorio" },

  // ─── Catálogos por agente
  "GET /catalog/carriers": { summary: "Aseguradoras del asesor", responseIsList: true },
  "GET /catalog/carriers/:id": { summary: "Detalle de una aseguradora" },
  "POST /catalog/carriers": { summary: "Crea una aseguradora", body: CarrierSchema, created: true },
  "PATCH /catalog/carriers/:id": { summary: "Actualiza una aseguradora", body: CarrierSchema, partialBody: true },
  "DELETE /catalog/carriers/:id": { summary: "Da de baja una aseguradora" },
  "GET /catalog/branches": { summary: "Ramos del asesor", responseIsList: true },
  "GET /catalog/branches/:id": { summary: "Detalle de un ramo" },
  "POST /catalog/branches": { summary: "Crea un ramo", body: BranchSchema, created: true },
  "PATCH /catalog/branches/:id": { summary: "Actualiza un ramo", body: BranchSchema, partialBody: true },
  "DELETE /catalog/branches/:id": { summary: "Da de baja un ramo" },
  "GET /catalog/products": { summary: "Productos del asesor", responseIsList: true },
  "GET /catalog/products/:id": { summary: "Detalle de un producto" },
  "POST /catalog/products": { summary: "Crea un producto", body: ProductSchema, created: true },
  "PATCH /catalog/products/:id": { summary: "Actualiza un producto", body: ProductSchema, partialBody: true },
  "DELETE /catalog/products/:id": { summary: "Da de baja un producto" },

  // ─── Catálogos globales (solo lectura)
  "GET /catalog/currencies": { summary: "Monedas", responseIsList: true },
  "GET /catalog/payment-frequencies": { summary: "Frecuencias de pago", responseIsList: true },
  "GET /catalog/payment-methods": { summary: "Métodos de pago", responseIsList: true },
  "GET /catalog/policy-statuses": { summary: "Estatus de póliza", responseIsList: true },
  "GET /catalog/participant-roles": { summary: "Roles de participante", responseIsList: true },
  "GET /catalog/reminder-types": { summary: "Tipos de recordatorio", responseIsList: true },
  "GET /catalog/reminder-statuses": { summary: "Estatus de recordatorio", responseIsList: true },
};
