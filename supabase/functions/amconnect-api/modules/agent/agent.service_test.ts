import { deepStrictEqual as assertEquals } from "node:assert";
import { AgentService } from "./agent.service.ts";
import type { IAgentRepository } from "./agent.repository.ts";
import { PRIVACY_POLICY_VERSION } from "../../shared/legal.ts";

class FakeRepo implements IAgentRepository {
  row: Record<string, unknown> = { id: "a", full_name: "A", locale: null, privacy_accepted_version: null, privacy_accepted_at: null };
  accepted: string[] = [];
  findById() { return Promise.resolve(this.row); }
  update() { return Promise.resolve(this.row); }
  updateTimezone() { return Promise.resolve(); }
  updateLocale() { return Promise.resolve(); }
  acceptPrivacyPolicy(v: string) {
    this.accepted.push(v);
    this.row = { ...this.row, privacy_accepted_version: v, privacy_accepted_at: "2026-11-21T00:00:00Z" };
    return Promise.resolve();
  }
}

Deno.test("getMe: sin aceptar, privacy.required es true y locale viene", async () => {
  const me = await new AgentService(new FakeRepo()).getMe("a") as Record<string, unknown>;
  const p = me.privacy as Record<string, unknown>;
  assertEquals(p.required, true);
  assertEquals(p.acceptedVersion, null);
  assertEquals(p.currentVersion, PRIVACY_POLICY_VERSION);
  assertEquals("locale" in me, true);
  assertEquals("privacyAcceptedVersion" in me, false);
});

Deno.test("acceptPrivacy: la versión vigente se guarda y required pasa a false", async () => {
  const repo = new FakeRepo();
  const p = await new AgentService(repo).acceptPrivacy("a", PRIVACY_POLICY_VERSION);
  assertEquals(p.required, false);
  assertEquals(repo.accepted, [PRIVACY_POLICY_VERSION]);
});

Deno.test("acceptPrivacy: otra versión da ValidationError (422) y no escribe", async () => {
  const repo = new FakeRepo();
  let err: { statusCode?: number; errorCode?: string } = {};
  try {
    await new AgentService(repo).acceptPrivacy("a", "vieja");
  } catch (e) {
    err = e as typeof err;
  }
  assertEquals(err.statusCode, 422);
  assertEquals(err.errorCode, "VALIDATION_FAILED");
  assertEquals(repo.accepted, []);
});
