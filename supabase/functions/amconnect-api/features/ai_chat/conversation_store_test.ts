// ConversationStore: delega en AiSessionService (404, candado, guardado).
import "../../shared/testing/test_env.ts";
import assert from "node:assert/strict";
import { NotFoundError } from "../../shared/errors.ts";
import type { AiSessionService } from "./ai_session.service.ts";
import { SessionConversationStore } from "./conversation_store.ts";

function fakeSessions(ctx: unknown) {
  const calls: Array<[string, unknown[]]> = [];
  const rec = (n: string, ret: unknown = undefined) => (...a: unknown[]) => {
    calls.push([n, a]);
    return Promise.resolve(ret);
  };
  const svc = {
    getSessionContext: rec("getSessionContext", ctx),
    createSession: rec("createSession", "new-id"),
    getActivePendingTasks: rec("getActivePendingTasks", [{ id: "t" }]),
    acquireTurnLock: rec("acquireTurnLock"),
    releaseTurnLock: rec("releaseTurnLock"),
    saveChatRound: rec("saveChatRound", { promptTokens: 1, completionTokens: 1, totalTokens: 2 }),
    markSessionProviderError: rec("markSessionProviderError"),
  } as unknown as AiSessionService;
  return { svc, calls };
}

Deno.test("loadSession: sesión inexistente o ajena => 404", async () => {
  const store = new SessionConversationStore(fakeSessions(null).svc);
  await assert.rejects(() => store.loadSession("s"), NotFoundError);
});

Deno.test("loadSession: devuelve historial (copia), tipo e interaction id", async () => {
  const history = [{ role: "user", parts: [] }];
  const store = new SessionConversationStore(
    fakeSessions({ history, type: "policy_ingestion", last_interaction_id: "i-1" }).svc,
  );
  const s = await store.loadSession("s");
  assert.equal(s.type, "policy_ingestion");
  assert.equal(s.lastInteractionId, "i-1");
  assert.deepEqual(s.history, history);
  assert.notEqual(s.history, history);
});

Deno.test("loadSession: campos nulos => undefined", async () => {
  const store = new SessionConversationStore(fakeSessions({ history: null, type: null, last_interaction_id: null }).svc);
  assert.deepEqual(await store.loadSession("s"), { history: [], type: undefined, lastInteractionId: undefined });
});

Deno.test("candado, pendientes y error de proveedor delegan sin duplicar lógica", async () => {
  const { svc, calls } = fakeSessions({});
  const store = new SessionConversationStore(svc);
  await store.acquireTurnLock("s");
  await store.releaseTurnLock("s");
  assert.deepEqual(await store.getPendingTasks("s"), [{ id: "t" }]);
  await store.markProviderError("s", "boom");
  assert.deepEqual(calls.map((c) => c[0]), ["acquireTurnLock", "releaseTurnLock", "getActivePendingTasks", "markSessionProviderError"]);
  assert.deepEqual(calls[3][1], ["s", "boom"]);
});

Deno.test("saveTurn: mapea a saveChatRound con el mismo orden de argumentos", async () => {
  const { svc, calls } = fakeSessions({});
  const usage = { promptTokens: 3, completionTokens: 1, totalTokens: 4 };
  const out = await new SessionConversationStore(svc).saveTurn({
    agentId: "a", sessionId: "s", history: [], messages: [], totalUsage: usage, lastInteractionId: "i",
  });
  assert.equal(out.totalTokens, 2);
  assert.deepEqual(calls[0], ["saveChatRound", ["a", "s", [], [], usage, "i"]]);
});

Deno.test("createSession delega y devuelve el id", async () => {
  const id = await new SessionConversationStore(fakeSessions({}).svc).createSession("a", {
    triggerMessage: "m", sessionType: "chat", modelName: "x",
  });
  assert.equal(id, "new-id");
});
