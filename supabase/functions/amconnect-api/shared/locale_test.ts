import assert from "node:assert/strict";
import { localeToBackfill, normalizeAppLocale } from "./locale.ts";

Deno.test("normalizeAppLocale: etiquetas legadas → es/en, lo demás → null", () => {
  assert.equal(normalizeAppLocale("en_US"), "en");
  assert.equal(normalizeAppLocale("en-US,en;q=0.9"), "en");
  assert.equal(normalizeAppLocale("es-MX"), "es");
  assert.equal(normalizeAppLocale(" ES "), "es");
  assert.equal(normalizeAppLocale("fr-FR"), null);
  assert.equal(normalizeAppLocale(""), null);
  assert.equal(normalizeAppLocale(null), null);
});

Deno.test("D-024: null guardado + header en-US → se llena con 'en'", () => {
  assert.equal(localeToBackfill("en-US", null), "en");
});

Deno.test("D-024: valor legado 'en_US' + header es-MX → se normaliza con el header", () => {
  assert.equal(localeToBackfill("es-MX", "en_US"), "es");
});

Deno.test("D-024: 'es' guardado + header en-US (teléfono en inglés) → NO se escribe", () => {
  assert.equal(localeToBackfill("en-US", "es"), null);
  assert.equal(localeToBackfill("es", "en"), null);
});

Deno.test("D-024: sin header o con idioma desconocido → no se escribe", () => {
  assert.equal(localeToBackfill(undefined, null), null);
  assert.equal(localeToBackfill("fr-FR", "en_US"), null);
});
