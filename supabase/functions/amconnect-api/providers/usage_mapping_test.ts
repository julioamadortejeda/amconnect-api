// Mapeo de uso de tokens de cada proveedor al TokenUsage común: los tokens de
// razonamiento (thoughts) deben llegar, y valer 0 cuando el proveedor no los reporta.
import "../shared/testing/test_env.ts";
import assert from "node:assert/strict";
import { mapGenerateContentUsage, mapInteractionUsage } from "./google_genai.provider.ts";
import { mapLiveUsage } from "./gemini_live.provider.ts";

Deno.test("generateContent: thoughtsTokenCount se mapea a thoughtsTokens", () => {
  assert.deepEqual(
    mapGenerateContentUsage({
      promptTokenCount: 100,
      candidatesTokenCount: 20,
      totalTokenCount: 170,
      cachedContentTokenCount: 40,
      thoughtsTokenCount: 50,
    }),
    { promptTokens: 100, completionTokens: 20, totalTokens: 170, cachedTokens: 40, thoughtsTokens: 50 },
  );
});

Deno.test("generateContent: sin thoughtsTokenCount => thoughtsTokens 0", () => {
  const u = mapGenerateContentUsage({ promptTokenCount: 10, candidatesTokenCount: 2, totalTokenCount: 12 });
  assert.equal(u.thoughtsTokens, 0);
  assert.equal(u.cachedTokens, 0);
});

Deno.test("interactions: total_thought_tokens se mapea a thoughtsTokens", () => {
  assert.deepEqual(
    mapInteractionUsage({
      total_input_tokens: 200,
      total_output_tokens: 30,
      total_tokens: 280,
      total_cached_tokens: 60,
      total_thought_tokens: 50,
    }),
    { promptTokens: 200, completionTokens: 30, totalTokens: 280, cachedTokens: 60, thoughtsTokens: 50 },
  );
});

Deno.test("interactions: sin total_thought_tokens => thoughtsTokens 0", () => {
  assert.equal(mapInteractionUsage({ total_input_tokens: 1, total_output_tokens: 1 }).thoughtsTokens, 0);
});

Deno.test("live: acepta snake_case y camelCase; thoughts opcional", () => {
  assert.deepEqual(
    mapLiveUsage({ prompt_token_count: 5, candidates_token_count: 6, total_token_count: 11 }),
    { promptTokens: 5, completionTokens: 6, totalTokens: 11, cachedTokens: 0, thoughtsTokens: 0 },
  );
  assert.equal(mapLiveUsage({ promptTokenCount: 1, thoughtsTokenCount: 9 }).thoughtsTokens, 9);
});
