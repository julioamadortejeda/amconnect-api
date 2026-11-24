// classifyMessage: parseo de `moveExisting` (verdadero / falso / ausente / inválido)
// y que el uso de tokens del clasificador siga llegando.
import "../shared/testing/test_env.ts";
import assert from "node:assert/strict";
import { GoogleGenAiProvider } from "./google_genai.provider.ts";

function providerReturning(text: string) {
  const ai = {
    models: {
      generateContent: () => Promise.resolve({
        text,
        usageMetadata: { promptTokenCount: 10, candidatesTokenCount: 5, totalTokenCount: 15 },
      }),
    },
  };
  const promptService = { getPrompt: () => Promise.resolve("prompt") };
  return new GoogleGenAiProvider(ai as never, "m", promptService as never);
}

const classify = (text: string) => providerReturning(text).classifyMessage("x", ["reminder", "contact"]);

Deno.test("classifyMessage: moveExisting true (camelCase y snake_case)", async () => {
  assert.equal((await classify('{"domains":["reminder"],"moveExisting":true}')).moveExisting, true);
  assert.equal((await classify('{"domains":["reminder"],"move_existing":true}')).moveExisting, true);
});

Deno.test("classifyMessage: moveExisting false, ausente o de tipo inválido => false", async () => {
  assert.equal((await classify('{"domains":["reminder"],"moveExisting":false}')).moveExisting, false);
  assert.equal((await classify('{"domains":["reminder"]}')).moveExisting, false);
  assert.equal((await classify('{"domains":["reminder"],"moveExisting":"true"}')).moveExisting, false);
  assert.equal((await classify('{"domains":["reminder"],"moveExisting":null}')).moveExisting, false);
});

Deno.test("classifyMessage: JSON inválido => todos los dominios, moveExisting false", async () => {
  const origWarn = console.warn;
  console.warn = () => {};
  try {
    const r = await classify('{"domains":["rem');
    assert.equal(r.moveExisting, false);
    assert.deepEqual(r.domains, ["reminder", "contact"]);
  } finally {
    console.warn = origWarn;
  }
});

Deno.test("classifyMessage: el uso de tokens se sigue reportando", async () => {
  const r = await classify('{"domains":[],"moveExisting":true}');
  assert.equal(r.usage?.totalTokens, 15);
});
