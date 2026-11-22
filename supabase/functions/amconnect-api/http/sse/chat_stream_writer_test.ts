// Traducción AgentEvent → evento SSE y numeración.
import assert from "node:assert/strict";
import { ChatStreamWriter, toStreamMessage } from "./chat_stream_writer.ts";
import { RagAttachmentCollector } from "../../features/ai_chat/rag_attachments.ts";

Deno.test("toStreamMessage: 1:1 con el diseño; tool sin nombre técnico", () => {
  assert.deepEqual(toStreamMessage({ type: "model_call_started", call: 1, forceTextOnly: false }, "s-1"), {
    event: "status",
    data: { phase: "thinking", sessionId: "s-1" },
  });
  assert.deepEqual(toStreamMessage({ type: "tool_started", name: "search_contact", label: "Buscando contacto" }, "s-1"), {
    event: "tool",
    data: { label: "Buscando contacto", state: "started" },
  });
  assert.deepEqual(toStreamMessage({ type: "tool_finished", name: "search_contact", label: "Buscando contacto", ok: false }, "s-1"), {
    event: "tool",
    data: { label: "Buscando contacto", state: "finished", ok: false },
  });
  assert.deepEqual(toStreamMessage({ type: "text", text: "hola" }, undefined), { event: "delta", data: { text: "hola" } });
});

Deno.test("toStreamMessage: done/cancelled/exhausted del loop no viajan (los emite el turno al guardar)", () => {
  assert.equal(toStreamMessage({ type: "exhausted", reason: "max_loops", maxLoops: 6 }, "s"), null);
  assert.equal(toStreamMessage({ type: "cancelled", modelCalls: 1 }, "s"), null);
  assert.equal(
    toStreamMessage({
      type: "done",
      text: "x",
      usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
      citedNoteIds: new Set(),
      ragAttachments: new RagAttachmentCollector(),
      skillMetadata: undefined,
      lastInteractionId: undefined,
      modelCalls: 1,
    }, "s"),
    null,
  );
  assert.deepEqual(toStreamMessage({ type: "model_call_started", call: 1, forceTextOnly: false }, undefined)?.data, { phase: "thinking" });
});

Deno.test("ChatStreamWriter: ids secuenciales, data en JSON, sessionId en status", async () => {
  const sent: { event: string; data: string; id: string }[] = [];
  const w = new ChatStreamWriter((m) => (sent.push(m), Promise.resolve()));
  w.setSession("s-9");
  await w.onAgentEvent({ type: "model_call_started", call: 1, forceTextOnly: false });
  await w.onAgentEvent({ type: "exhausted", reason: "max_loops", maxLoops: 6 });
  await w.onAgentEvent({ type: "text", text: "hola" });
  await w.done({ text: "hola", sessionId: "s-9" });
  assert.deepEqual(sent.map((m) => [m.id, m.event]), [["1", "status"], ["2", "delta"], ["3", "done"]]);
  assert.deepEqual(JSON.parse(sent[0].data), { phase: "thinking", sessionId: "s-9" });
  await w.error({ errorCode: "AI_ERROR", error: "x" });
  await w.cancelled({ sessionId: "s-9", modelCalls: 0 });
  assert.deepEqual(sent.slice(3).map((m) => [m.id, m.event]), [["4", "error"], ["5", "cancelled"]]);
});
