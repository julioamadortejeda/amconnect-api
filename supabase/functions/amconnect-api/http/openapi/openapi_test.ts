// El documento OpenAPI no puede quedarse atrás del router: si alguien agrega una
// ruta sin documentarla (o deja documentación de una ruta que ya no existe),
// estas pruebas truenan.
import "../../shared/testing/test_env.ts";
import assert from "node:assert/strict";
import { apiRouter } from "../routes/index.ts";
import { buildOpenApiDocument, routeKey } from "./openapi.builder.ts";
import { ROUTE_DOCS } from "./route_docs.ts";
import { SUBSCRIPTION_EXEMPT_ROUTES } from "../middleware/subscription_exempt.ts";

// deno-lint-ignore no-explicit-any
type Doc = any;
const doc: Doc = buildOpenApiDocument(apiRouter);
const toOpenApiPath = (p: string) => p.replace(/:([A-Za-z0-9_]+)/g, "{$1}");
const operations = () =>
  apiRouter.routes.filter((r) => r.method !== "ALL").map((r) => ({ key: routeKey(r.method, r.path), ...r }));

Deno.test("openapi: toda ruta del router está en el documento (o excluida a propósito)", () => {
  const missing: string[] = [];
  for (const r of operations()) {
    const entry = ROUTE_DOCS[r.key];
    if (!entry) {
      missing.push(`${r.key} (sin entrada en ROUTE_DOCS)`);
      continue;
    }
    if (entry.internal) {
      assert.equal(doc.paths[toOpenApiPath(r.path)]?.[r.method.toLowerCase()], undefined, `${r.key} es interna y no debe publicarse`);
      continue;
    }
    if (!doc.paths[toOpenApiPath(r.path)]?.[r.method.toLowerCase()]) missing.push(`${r.key} (no aparece en paths)`);
  }
  assert.deepEqual(missing, [], `Rutas sin documentar: ${missing.join(", ")}`);
});

Deno.test("openapi: ROUTE_DOCS no documenta rutas que ya no existen", () => {
  const real = new Set(operations().map((r) => r.key));
  const stale = Object.keys(ROUTE_DOCS).filter((k) => !real.has(k));
  assert.deepEqual(stale, []);
});

Deno.test("openapi: forma válida (versión, paths, securitySchemes, sobre de error)", () => {
  assert.match(doc.openapi, /^3\.1\./);
  assert.ok(doc.info.title && doc.info.version);
  assert.ok(Object.keys(doc.paths).length > 50);
  assert.equal(doc.components.securitySchemes.bearerAuth.scheme, "bearer");
  assert.deepEqual(doc.components.schemas.ErrorEnvelope.required, ["success", "error", "errorCode"]);
  assert.deepEqual(doc.paths["/health"].get.security, []);
  assert.deepEqual(doc.paths["/openapi.json"].get.security, []);
  // JSON serializable y sin $ref colgantes
  const text = JSON.stringify(doc);
  for (const [, ref] of text.matchAll(/"\$ref":"#\/components\/schemas\/([^"]+)"/g)) {
    assert.ok(doc.components.schemas[ref], `$ref roto: ${ref}`);
  }
});

Deno.test("openapi: params y query salen de los esquemas de validate()", () => {
  const get = doc.paths["/contacts/{id}/notes"].get;
  const names = get.parameters.map((p: Doc) => `${p.in}:${p.name}`).sort();
  assert.deepEqual(names, ["path:id", "query:page", "query:pageSize"]);
  assert.equal(get.parameters.find((p: Doc) => p.name === "id").schema.format, "uuid");
  assert.equal(get.parameters.find((p: Doc) => p.name === "page").required, false);
  // listado paginado: el `data` es la página
  assert.deepEqual(get.responses["200"].content["application/json"].schema.properties.data.required, ["data", "page", "pageSize", "hasMore"]);
  // fileName es obligatorio en el query de upload-url
  const up = doc.paths["/ai/upload-url"].get.parameters.find((p: Doc) => p.name === "fileName");
  assert.equal(up.required, true);
});

Deno.test("openapi: 402 en las rutas con cobro y no en las exentas; 422 donde hay validación", () => {
  for (const r of operations()) {
    if (ROUTE_DOCS[r.key]?.internal) continue;
    const op = doc.paths[toOpenApiPath(r.path)][r.method.toLowerCase()];
    assert.equal(Boolean(op.responses["402"]), !SUBSCRIPTION_EXEMPT_ROUTES.has(r.key), r.key);
    assert.deepEqual(op.security, [{ bearerAuth: [] }], r.key);
  }
  assert.ok(doc.paths["/contacts/{id}"].get.responses["422"]);
  assert.ok(doc.paths["/ai/chat"].post.responses["429"]);
});

Deno.test("openapi: 429 RATE_LIMITED con Retry-After en toda ruta autenticada; QUOTA_EXCEEDED solo donde hay cuota", () => {
  for (const r of operations()) {
    if (ROUTE_DOCS[r.key]?.internal) continue;
    const res = doc.paths[toOpenApiPath(r.path)][r.method.toLowerCase()].responses["429"];
    assert.ok(res, r.key);
    assert.ok(res.headers["Retry-After"], r.key);
    const examples = res.content["application/json"].examples;
    assert.equal(examples.RATE_LIMITED.value.errorCode, "RATE_LIMITED", r.key);
    assert.equal(Boolean(examples.QUOTA_EXCEEDED), Boolean(ROUTE_DOCS[r.key]?.quota), r.key);
  }
  assert.ok(doc.paths["/ai/chat"].post.responses["429"].content["application/json"].examples.QUOTA_EXCEEDED);
  assert.equal(doc.paths["/health"].get.responses["429"], undefined);
  assert.equal(doc.paths["/openapi.json"].get.responses["429"], undefined);
});

Deno.test("openapi: el body referencia el esquema del DTO (PATCH = parcial)", () => {
  const post = doc.paths["/catalog/products"].post.requestBody.content["application/json"].schema;
  const patch = doc.paths["/catalog/products/{id}"].patch.requestBody.content["application/json"].schema;
  assert.deepEqual(post.required.sort(), ["branchId", "carrierId", "name"]);
  assert.equal(patch.required, undefined);
  assert.ok(post.properties.carrierId);
});

Deno.test("openapi: el WebSocket de voz no se publica", () => {
  assert.equal(doc.paths["/ai/voice"], undefined);
  assert.ok(doc.paths["/ai/voice/token"]);
});
