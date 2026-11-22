// Arma el documento OpenAPI 3.1 a partir del router REAL y de los esquemas Zod
// que ya usa el backend. No ejecuta nada del router: solo lo lee (`router.routes`).
//
// - Rutas, params y query: del router + `validatorMeta` (lo que `validate()` valida).
// - Body: de `ROUTE_DOCS` (mismo esquema del DTO que parsea el controller).
// - 402: de `SUBSCRIPTION_EXEMPT_ROUTES` (misma lista que usa el DI).
// - 429: en toda ruta autenticada (límite por minuto, D-027) y además la cuota
//   mensual en las rutas con `quota`.
// Zod → JSON Schema con `zod-to-json-schema` (ya es dependencia del backend).
import type { Hono } from "hono";
import { zodToJsonSchema } from "zod-to-json-schema";
import { ZodObject, type ZodTypeAny } from "zod";
import { validatorMeta } from "../middleware/validate.ts";
import { SUBSCRIPTION_EXEMPT_ROUTES } from "../middleware/subscription_exempt.ts";
import { ROUTE_DOCS, type RouteDoc } from "./route_docs.ts";

type Json = Record<string, unknown>;

const HTTP_METHODS = new Set(["GET", "POST", "PUT", "PATCH", "DELETE"]);

/** Clave `"METHOD /ruta"` con la que el router, `ROUTE_DOCS` y la exención de cobro hablan de una ruta. */
export function routeKey(method: string, path: string): string {
  return `${method.toUpperCase()} ${path}`;
}

/** Rutas del router que SÍ entran al documento (REST/JSON, con entrada en `ROUTE_DOCS` y no internas). */
export function documentedRouterRoutes(router: Hono): Array<{ method: string; path: string; handlers: unknown[] }> {
  const byKey = new Map<string, { method: string; path: string; handlers: unknown[] }>();
  for (const r of router.routes) {
    if (!HTTP_METHODS.has(r.method)) continue; // `ALL` = middleware, no una operación
    const key = routeKey(r.method, r.path);
    const entry = byKey.get(key) ?? { method: r.method, path: r.path, handlers: [] };
    entry.handlers.push(r.handler);
    byKey.set(key, entry);
  }
  return [...byKey.values()].filter((r) => !ROUTE_DOCS[routeKey(r.method, r.path)]?.internal);
}

function toJsonSchema(schema: ZodTypeAny): Json {
  // deno-lint-ignore no-explicit-any
  const { $schema: _omit, ...rest } = zodToJsonSchema(schema as any, { target: "jsonSchema7", $refStrategy: "none" }) as Json;
  return rest;
}

const GENERIC_OBJECT: Json = { type: "object", additionalProperties: true };

function envelope(data: Json): Json {
  return {
    type: "object",
    required: ["success", "data"],
    properties: { success: { type: "boolean", const: true }, data },
  };
}

const PAGE_DATA: Json = {
  type: "object",
  required: ["data", "page", "pageSize", "hasMore"],
  properties: {
    data: { type: "array", items: GENERIC_OBJECT },
    total: { type: "integer", description: "Se omite cuando la fuente no puede contar." },
    page: { type: "integer", minimum: 1 },
    pageSize: { type: "integer", minimum: 1 },
    hasMore: { type: "boolean" },
  },
};

function errorResponse(description: string, errorCode: string): Json {
  return {
    description,
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/ErrorEnvelope" },
        example: { success: false, error: description, errorCode },
      },
    },
  };
}

// 429 posible en TODA ruta autenticada: límite por minuto del asesor (D-027,
// shared/security.config.ts). En las rutas que cobran cuota también puede ser la
// cuota mensual del plan; mismo status, distinto errorCode. Solo RATE_LIMITED
// trae `Retry-After`.
function tooManyRequestsResponse(quota: boolean): Json {
  const rateLimited = "Vas muy rápido, espera un momento e intenta de nuevo.";
  const examples: Json = {
    RATE_LIMITED: {
      summary: "Límite por minuto rebasado (esperar Retry-After segundos)",
      value: { success: false, error: rateLimited, errorCode: "RATE_LIMITED" },
    },
  };
  if (quota) {
    examples.QUOTA_EXCEEDED = {
      summary: "Cuota mensual del plan agotada",
      value: { success: false, error: "Cuota mensual del plan agotada.", errorCode: "QUOTA_EXCEEDED" },
    };
  }
  return {
    description: quota
      ? "Límite por minuto rebasado (RATE_LIMITED) o cuota mensual del plan agotada (QUOTA_EXCEEDED)."
      : "Límite por minuto rebasado (RATE_LIMITED).",
    headers: {
      "Retry-After": {
        description: "Segundos a esperar antes de reintentar (solo con RATE_LIMITED).",
        schema: { type: "integer", minimum: 1 },
      },
    },
    content: {
      "application/json": {
        schema: { $ref: "#/components/schemas/ErrorEnvelope" },
        examples,
      },
    },
  };
}

/** `:id` → `{id}` */
function toOpenApiPath(path: string): string {
  return path.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
}

function objectParameters(schema: ZodTypeAny, where: "path" | "query"): Json[] {
  const json = toJsonSchema(schema) as { properties?: Record<string, Json>; required?: string[] };
  const required = new Set(json.required ?? []);
  return Object.entries(json.properties ?? {}).map(([name, s]) => ({
    name,
    in: where,
    required: where === "path" ? true : required.has(name),
    schema: s,
  }));
}

function successSchema(doc: RouteDoc, paginated: boolean): Json {
  if (paginated) return envelope(PAGE_DATA);
  const item = doc.response ? toJsonSchema(doc.response) : GENERIC_OBJECT;
  return envelope(doc.responseIsList ? { type: "array", items: item } : item);
}

function successResponse(doc: RouteDoc, paginated: boolean): Json {
  if (doc.eventStream) {
    return {
      description: doc.eventStream,
      content: { "text/event-stream": { schema: { type: "string", description: "Eventos SSE (ver descripción)." } } },
    };
  }
  return { description: "Éxito", content: { "application/json": { schema: successSchema(doc, paginated) } } };
}

function buildOperation(route: { method: string; path: string; handlers: unknown[] }, doc: RouteDoc): Json {
  const key = routeKey(route.method, route.path);
  const parameters: Json[] = [];
  let paginated = false;
  let validated = false;

  for (const h of route.handlers) {
    const meta = typeof h === "function" ? validatorMeta.get(h) : undefined;
    if (!meta) continue;
    validated = true;
    if (meta.target === "param") parameters.push(...objectParameters(meta.schema, "path"));
    else {
      parameters.push(...objectParameters(meta.schema, "query"));
      paginated = meta.schema instanceof ZodObject && "page" in meta.schema.shape;
    }
  }

  const billed = !SUBSCRIPTION_EXEMPT_ROUTES.has(key);
  const responses: Json = {
    [doc.created ? "201" : "200"]: successResponse(doc, paginated),
    "401": errorResponse("Token ausente, inválido o expirado.", "SESSION_EXPIRED"),
  };
  if (billed) responses["402"] = errorResponse("Suscripción vencida o periodo de prueba terminado.", "SUBSCRIPTION_REQUIRED");
  if (validated || doc.body) responses["422"] = errorResponse("Parámetros, query o body inválidos.", "VALIDATION_FAILED");
  responses["429"] = tooManyRequestsResponse(Boolean(doc.quota));

  const op: Json = {
    operationId: `${route.method.toLowerCase()}_${route.path.replace(/[^A-Za-z0-9]+/g, "_").replace(/^_|_$/g, "")}`,
    summary: doc.summary,
    tags: [route.path.split("/")[1]],
    security: [{ bearerAuth: [] }],
    responses,
    "x-subscription-required": billed,
  };
  if (parameters.length) op.parameters = parameters;
  if (doc.body) {
    const schema = doc.partialBody && doc.body instanceof ZodObject ? doc.body.partial() : doc.body;
    op.requestBody = {
      required: !doc.bodyOptional,
      content: { "application/json": { schema: toJsonSchema(schema) } },
    };
  } else if (doc.bodyOptional || ["POST", "PATCH", "PUT"].includes(route.method)) {
    op.requestBody = { required: false, content: { "application/json": { schema: GENERIC_OBJECT } } };
  }
  return op;
}

/** Rutas públicas montadas en `index.ts` fuera del router (sin auth ni cobro). */
function publicPaths(): Json {
  const json = (schema: Json) => ({ description: "Éxito", content: { "application/json": { schema } } });
  return {
    "/health": {
      get: {
        operationId: "get_health",
        summary: "Estado del servicio",
        tags: ["system"],
        security: [],
        responses: {
          "200": json(envelope({
            type: "object",
            properties: { status: { type: "string" }, timestamp: { type: "string", format: "date-time" } },
          })),
        },
      },
    },
    "/openapi.json": {
      get: {
        operationId: "get_openapi",
        summary: "Este documento OpenAPI",
        tags: ["system"],
        security: [],
        responses: { "200": { description: "Documento OpenAPI 3.1 (JSON crudo, sin sobre)." } },
      },
    },
  };
}

export function buildOpenApiDocument(router: Hono): Json {
  const paths: Record<string, Json> = publicPaths() as Record<string, Json>;
  for (const route of documentedRouterRoutes(router)) {
    const doc = ROUTE_DOCS[routeKey(route.method, route.path)];
    if (!doc) continue; // sin entrada: `openapi_test.ts` lo reporta
    const p = toOpenApiPath(route.path);
    paths[p] = { ...paths[p], [route.method.toLowerCase()]: buildOperation(route, doc) };
  }

  return {
    openapi: "3.1.0",
    info: {
      title: "AmConnect API",
      version: "1.0.0",
      description:
        "Contrato REST de AmConnect. Toda respuesta usa el sobre `{ success, data }` o, en error, " +
        "`{ success: false, error, errorCode, errorId? }`. Excluidos a propósito: el canal de voz " +
        "`GET /ai/voice` (WebSocket) y los endpoints internos de cron (`/notifications/send-due`, " +
        "`/reminders/generate-due`), que usan un secreto compartido y no son parte del contrato de la app.",
    },
    servers: [{ url: "{baseUrl}/functions/v1/amconnect-api", variables: { baseUrl: { default: "http://127.0.0.1:54321" } } }],
    security: [{ bearerAuth: [] }],
    paths,
    components: {
      securitySchemes: {
        bearerAuth: { type: "http", scheme: "bearer", bearerFormat: "JWT", description: "JWT de Supabase Auth del asesor." },
      },
      schemas: {
        ErrorEnvelope: {
          type: "object",
          required: ["success", "error", "errorCode"],
          properties: {
            success: { type: "boolean", const: false },
            error: { type: "string", description: "Mensaje humano de respaldo (español)." },
            errorCode: { type: "string", description: "Código estable; la app traduce por este valor.", examples: ["VALIDATION_FAILED"] },
            errorId: { type: "string", format: "uuid", description: "Id del registro en error_logs, si se pudo persistir." },
          },
        },
      },
    },
  };
}
