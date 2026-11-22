// Seguimiento de tokens: thoughts y cache del clasificador llegan a tokens_usage,
// el repositorio los persiste, y el acumulado de sesión se calcula sin duplicar.
import "../../shared/testing/test_env.ts";
import assert from "node:assert/strict";
import { AiSessionRepository, type ModelRatesRow } from "./ai_session.repository.ts";
import { AiSessionService } from "./ai_session.service.ts";
import { buildAssistantHarness, postChat, quietLogs, say, usage } from "../../shared/testing/assistant_harness.ts";

// deno-lint-ignore no-explicit-any
function fakeSupabase(selectRows: any[] = []) {
  // deno-lint-ignore no-explicit-any
  const inserted: any[] = [];
  const client = {
    from: (_t: string) => ({
      // deno-lint-ignore no-explicit-any
      insert: (rows: any) => {
        inserted.push(...rows);
        return Promise.resolve({ error: null });
      },
      select: () => ({ eq: () => Promise.resolve({ data: selectRows, error: null }) }),
    }),
  };
  // deno-lint-ignore no-explicit-any
  return { client: client as any, inserted };
}

Deno.test("repositorio: thoughts se guarda y total_tokens = prompt + completion + thoughts", async () => {
  const { client, inserted } = fakeSupabase();
  await new AiSessionRepository(client).logTokenUsage({
    agentId: "a", sessionId: "s", source: "chat_text", modelName: "m",
    promptTokens: 100, completionTokens: 20, cachedTokens: 30, thoughtsTokens: 50,
  });
  assert.equal(inserted[0].thoughts_tokens, 50);
  assert.equal(inserted[0].total_tokens, 170);
  assert.equal(inserted[0].cached_tokens, 30);
});

Deno.test("repositorio: sin thoughts => 0 y total sin cambio", async () => {
  const { client, inserted } = fakeSupabase();
  await new AiSessionRepository(client).logTokenUsage({
    agentId: "a", source: "embedding", modelName: "m", promptTokens: 7, completionTokens: 0,
  });
  assert.equal(inserted[0].thoughts_tokens, 0);
  assert.equal(inserted[0].total_tokens, 7);
});

Deno.test("repositorio: getSessionTokens suma thoughts y cache de todas las filas", async () => {
  const { client } = fakeSupabase([
    { prompt_tokens: 10, completion_tokens: 2, total_tokens: 17, cached_tokens: 4, thoughts_tokens: 5 },
    { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2, cached_tokens: 1, thoughts_tokens: null },
  ]);
  assert.deepEqual(await new AiSessionRepository(client).getSessionTokens("s"), {
    promptTokens: 11, completionTokens: 3, totalTokens: 19, cachedTokens: 5, thoughtsTokens: 5,
  });
});

Deno.test("chat: el clasificador propaga cached y thoughts a su fila de tokens_usage", async () => {
  const h = buildAssistantHarness({
    script: [say("ok", usage(200, 20, 50, 40))],
    classify: { domains: ["contact"], language: "Spanish", usage: usage(30, 3, 12, 7) },
  });
  await quietLogs(() => postChat(h, { message: "hola" }));
  const rows = h.sessionsRepo.tokenRows;
  const cls = rows.find((r) => r.promptTokens === 30)!;
  assert.equal(cls.cachedTokens, 12);
  assert.equal(cls.thoughtsTokens, 7);
  const model = rows.find((r) => r.promptTokens === 200)!;
  assert.equal(model.cachedTokens, 50);
  assert.equal(model.thoughtsTokens, 40);
});

Deno.test("chat: usage y sessionUsage incluyen cache y thoughts del clasificador + bucle, sin duplicar", async () => {
  const h = buildAssistantHarness({
    script: [say("ok", usage(200, 20, 50, 40))],
    classify: { domains: ["contact"], language: "Spanish", usage: usage(30, 3, 12, 7) },
  });
  const { json } = await quietLogs(() => postChat(h, { message: "hola" }));
  assert.equal(json.data.usage.cachedTokens, 62);
  assert.equal(json.data.usage.thoughtsTokens, 47);
  assert.equal(json.data.sessionUsage.cachedTokens, 62);
  assert.equal(json.data.sessionUsage.thoughtsTokens, 47);
  assert.equal(json.data.sessionUsage.totalTokens, 230 + 23 + 47);
});

Deno.test("saveChatRound: el acumulado de sesión (cache incluido) no cuenta el turno dos veces", async () => {
  const h = buildAssistantHarness({ script: [say("a", usage(100, 10, 20)), say("b", usage(50, 5, 10))] });
  const a = await quietLogs(() => postChat(h, { message: "uno" }));
  const b = await quietLogs(() => postChat(h, { message: "dos", sessionId: a.json.data.sessionId }));
  assert.equal(b.json.data.sessionUsage.cachedTokens, 30);
});

Deno.test("getSessionCost: thoughts se cobran a tarifa de salida", async () => {
  const bucket = {
    promptTokens: 0, completionTokens: 1_000_000, totalTokens: 0, cachedTokens: 0, thoughtsTokens: 1_000_000,
    textPromptTokens: 0, audioPromptTokens: 0, textCompletionTokens: 0, audioCompletionTokens: 0,
  };
  const z = { ...bucket, completionTokens: 0, thoughtsTokens: 0 };
  const model = {
    display_name: "m", input_cost_per_1m: 1, output_cost_per_1m: 2, cache_read_cost_per_1m: 0,
    audio_input_cost_per_1m: null, audio_output_cost_per_1m: null,
  } as unknown as ModelRatesRow;
  // deno-lint-ignore no-explicit-any
  const repo: any = {
    getSessionWithRates: () => Promise.resolve({ id: "s", model_name: "m", chat_model: model, embedding_model: null, tts_model: null }),
    getSessionTokenUsageDetails: () => Promise.resolve({ chat: bucket, extraction: z, embedding: z, summary: z }),
  };
  const cost = await new AiSessionService(repo).getSessionCost("s");
  // 1M salida visible + 1M thoughts, a $2/1M = $4
  assert.equal((cost.chat as { cost: { outputUsd: number } }).cost.outputUsd, 4);
});
