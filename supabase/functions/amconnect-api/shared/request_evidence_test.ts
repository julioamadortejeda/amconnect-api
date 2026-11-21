import { deepStrictEqual as assertEquals } from "node:assert";
import { extractClientIp, extractRequestEvidence, normalizeLocale } from "./request_evidence.ts";

const h = (o: Record<string, string>) => new Headers(o);

Deno.test("IP: toma el primer elemento de x-forwarded-for", () => {
  assertEquals(extractClientIp(h({ "x-forwarded-for": "203.0.113.7, 10.0.0.1" })), "203.0.113.7");
});

Deno.test("IP: respaldo x-real-ip y cf-connecting-ip, y null si no hay", () => {
  assertEquals(extractClientIp(h({ "x-real-ip": "198.51.100.2" })), "198.51.100.2");
  assertEquals(extractClientIp(h({ "cf-connecting-ip": "2001:db8::1" })), "2001:db8::1");
  assertEquals(extractClientIp(h({})), null);
});

Deno.test("IP: quita puerto y corchetes", () => {
  assertEquals(extractClientIp(h({ "x-forwarded-for": "1.2.3.4:5678" })), "1.2.3.4");
  assertEquals(extractClientIp(h({ "x-forwarded-for": "[::1]:80" })), "::1");
});

Deno.test("locale: x-locale gana, Accept-Language se normaliza a es/en", () => {
  assertEquals(normalizeLocale(h({ "x-locale": "en", "accept-language": "es" })), "en");
  assertEquals(normalizeLocale(h({ "accept-language": "en-US,en;q=0.9" })), "en");
  assertEquals(normalizeLocale(h({ "accept-language": "fr-FR" })), "es");
  assertEquals(normalizeLocale(h({})), null);
});

Deno.test("evidencia: plataforma inválida -> null, user-agent truncado", () => {
  const e = extractRequestEvidence(h({
    "user-agent": "x".repeat(900),
    "x-app-version": "1.4.0+23",
    "x-platform": "IOS",
  }));
  assertEquals(e.platform, "ios");
  assertEquals(e.userAgent?.length, 500);
  assertEquals(e.appVersion, "1.4.0+23");
  assertEquals(extractRequestEvidence(h({ "x-platform": "palm" })).platform, null);
});
