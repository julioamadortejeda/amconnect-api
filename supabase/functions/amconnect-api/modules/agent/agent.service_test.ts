import { deepStrictEqual as assertEquals } from "node:assert";
import { AgentService } from "./agent.service.ts";
import type { IAgentRepository, PrivacyConsentRecord } from "./agent.repository.ts";
import { PRIVACY_POLICY_VERSION } from "../../shared/legal.ts";

const EVIDENCE = { ip: "203.0.113.7", userAgent: "ua", appVersion: "1.4.0+23", platform: "ios", locale: "es" } as const;
const consent = (version: string) => ({ version, acceptedNotice: true, acceptedSensitive: true } as const);

class FakeRepo implements IAgentRepository {
  row: Record<string, unknown> = { id: "a", full_name: "A", locale: null, privacy_accepted_version: null, privacy_accepted_at: null };
  accepted: PrivacyConsentRecord[] = [];
  findById() { return Promise.resolve(this.row); }
  update() { return Promise.resolve(this.row); }
  updateTimezone() { return Promise.resolve(); }
  updateLocale() { return Promise.resolve(); }
  recordPrivacyConsent(r: PrivacyConsentRecord) {
    this.accepted.push(r);
    this.row = { ...this.row, privacy_accepted_version: r.version, privacy_accepted_at: "2026-11-21T00:00:00Z" };
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
  const p = await new AgentService(repo).acceptPrivacy("a", consent(PRIVACY_POLICY_VERSION), EVIDENCE);
  assertEquals(p.required, false);
  assertEquals(repo.accepted, [{ ...consent(PRIVACY_POLICY_VERSION), evidence: EVIDENCE }]);
});

Deno.test("acceptPrivacy: otra versión da ValidationError (422) y no escribe", async () => {
  const repo = new FakeRepo();
  let err: { statusCode?: number; errorCode?: string } = {};
  try {
    await new AgentService(repo).acceptPrivacy("a", consent("vieja"), EVIDENCE);
  } catch (e) {
    err = e as typeof err;
  }
  assertEquals(err.statusCode, 422);
  assertEquals(err.errorCode, "VALIDATION_FAILED");
  assertEquals(repo.accepted, []);
});

Deno.test("PrivacyConsentSchema: exige ambas casillas en true", async () => {
  const { PrivacyConsentSchema } = await import("./agent.dto.ts");
  assertEquals(PrivacyConsentSchema.safeParse({ version: "v", acceptedNotice: true, acceptedSensitive: true }).success, true);
  assertEquals(PrivacyConsentSchema.safeParse({ version: "v" }).success, false);
  assertEquals(PrivacyConsentSchema.safeParse({ version: "v", acceptedNotice: true, acceptedSensitive: false }).success, false);
  assertEquals(PrivacyConsentSchema.safeParse({ version: "v", acceptedNotice: false, acceptedSensitive: true }).success, false);
});
