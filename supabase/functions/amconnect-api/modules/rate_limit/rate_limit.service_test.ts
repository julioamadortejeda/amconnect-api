import assert from "node:assert/strict";
import { bucketFor, RateLimitService } from "./rate_limit.service.ts";
import type { IRateLimitRepository } from "./rate_limit.repository.ts";
import type { RateLimitBucket, RateLimitDecision, RateLimitRule } from "./rate_limit.dto.ts";
import { RateLimitedError } from "../../shared/errors.ts";
import { RATE_LIMITS } from "../../shared/security.config.ts";

class FakeRepo implements IRateLimitRepository {
  calls: Array<{ bucket: RateLimitBucket; rule: RateLimitRule }> = [];
  constructor(private result: RateLimitDecision | Error) {}
  consume(bucket: RateLimitBucket, rule: RateLimitRule): Promise<RateLimitDecision> {
    this.calls.push({ bucket, rule });
    return this.result instanceof Error ? Promise.reject(this.result) : Promise.resolve(this.result);
  }
}

Deno.test("config: los números de D-027 (60 general, 20 asistente, por minuto)", () => {
  assert.deepEqual(RATE_LIMITS.general, { limit: 60, windowSeconds: 60 });
  assert.deepEqual(RATE_LIMITS.ai, { limit: 20, windowSeconds: 60 });
});

Deno.test("bucketFor: /ai/* gasta del cupo ai; lo demás del general", () => {
  assert.equal(bucketFor("POST", "/ai/chat"), "ai");
  assert.equal(bucketFor("POST", "/ai/ingest"), "ai");
  assert.equal(bucketFor("POST", "/ai/voice/token"), "ai");
  assert.equal(bucketFor("POST", "/ai/voice/init"), "ai");
  assert.equal(bucketFor("GET", "/ai/voice"), "ai");
  assert.equal(bucketFor("GET", "/contacts"), "general");
  assert.equal(bucketFor("GET", "/aim"), "general", "solo el segmento /ai exacto");
});

Deno.test("bucketFor: la plomería de una voz ya abierta va al cupo general", () => {
  assert.equal(bucketFor("POST", "/ai/voice/execute-tool"), "general");
  assert.equal(bucketFor("post", "/ai/voice/save-round"), "general");
  assert.equal(bucketFor("GET", "/ai/voice/execute-tool"), "ai", "solo el método listado");
});

Deno.test("enforce: manda la regla del bucket y deja pasar si allowed", async () => {
  const repo = new FakeRepo({ allowed: true, remaining: 5, retryAfterSeconds: 0 });
  await new RateLimitService(repo).enforce("POST", "/ai/chat");
  assert.deepEqual(repo.calls, [{ bucket: "ai", rule: RATE_LIMITS.ai }]);
});

Deno.test("enforce: rechazado → RateLimitedError 429 con retryAfter", async () => {
  const repo = new FakeRepo({ allowed: false, remaining: 0, retryAfterSeconds: 17 });
  await assert.rejects(
    () => new RateLimitService(repo).enforce("GET", "/contacts"),
    (e: unknown) => {
      assert.ok(e instanceof RateLimitedError);
      assert.equal(e.statusCode, 429);
      assert.equal(e.errorCode, "RATE_LIMITED");
      assert.equal(e.retryAfterSeconds, 17);
      return true;
    },
  );
});

Deno.test("enforce: si el contador falla, deja pasar (fail-open) y lo registra", async () => {
  const repo = new FakeRepo(new Error("db down"));
  const original = console.error;
  const logged: unknown[][] = [];
  console.error = (...args: unknown[]) => logged.push(args);
  try {
    await new RateLimitService(repo).enforce("POST", "/ai/chat");
  } finally {
    console.error = original;
  }
  assert.equal(logged.length, 1);
  assert.match(String(logged[0][0]), /^\[RATE_LIMIT\]/);
});
