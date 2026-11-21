// Estado efectivo de la suscripción (trial vencido = expired, calculado) y
// mapeo de errores del código promocional.
import assert from "node:assert/strict";
import { SubscriptionService } from "./subscription.service.ts";
import { UsageService } from "./usage.service.ts";
import { AppError } from "../../shared/errors.ts";
import {
  buildAgentStatus,
  buildPlan,
  captureError,
  daysFromNow,
  FakeSubscriptionRepository,
  FakeUsageRepository,
} from "../../shared/testing/fakes.ts";

const AGENT = "agent-1";

function setup() {
  const repo = new FakeSubscriptionRepository();
  const usageRepo = new FakeUsageRepository();
  return { repo, usageRepo, service: new SubscriptionService(repo, new UsageService(usageRepo)) };
}

// ─── checkSubscriptionActive (la puerta del 402) ────────────────────────────

Deno.test("Subscription: trial con fecha futura pasa y devuelve el estado leído", async () => {
  const { repo, service } = setup();
  repo.agentStatus = buildAgentStatus({ subscriptionStatus: "trial", trialEndsAt: daysFromNow(3) });
  const status = await service.checkSubscriptionActive(AGENT);
  assert.equal(status.subscriptionStatus, "trial");
});

Deno.test("Subscription: trial con fecha pasada → 402 aunque la columna diga 'trial'", async () => {
  const { repo, service } = setup();
  repo.agentStatus = buildAgentStatus({ subscriptionStatus: "trial", trialEndsAt: daysFromNow(-1) });
  const err = await captureError<AppError>(() => service.checkSubscriptionActive(AGENT));
  assert.equal(err.statusCode, 402);
  assert.equal(err.errorCode, "SUBSCRIPTION_REQUIRED");
  assert.match(err.message, /período de prueba/);
});

for (const status of ["expired", "cancelled"]) {
  Deno.test(`Subscription: estado '${status}' → 402 SUBSCRIPTION_REQUIRED`, async () => {
    const { repo, service } = setup();
    repo.agentStatus = buildAgentStatus({ subscriptionStatus: status, trialEndsAt: null });
    const err = await captureError<AppError>(() => service.checkSubscriptionActive(AGENT));
    assert.equal(err.statusCode, 402);
    assert.equal(err.errorCode, "SUBSCRIPTION_REQUIRED");
  });
}

Deno.test("Subscription: 'active' pasa aunque tenga un trial viejo vencido", async () => {
  const { repo, service } = setup();
  repo.agentStatus = buildAgentStatus({ subscriptionStatus: "active", trialEndsAt: daysFromNow(-90) });
  await service.checkSubscriptionActive(AGENT);
});

Deno.test("Subscription: trial sin fecha de fin no se considera vencido", async () => {
  const { repo, service } = setup();
  repo.agentStatus = buildAgentStatus({ subscriptionStatus: "trial", trialEndsAt: null });
  await service.checkSubscriptionActive(AGENT);
});

Deno.test("Subscription: requireActive=false deja pasar un vencido (rutas exentas)", async () => {
  const { repo, service } = setup();
  repo.agentStatus = buildAgentStatus({ subscriptionStatus: "expired" });
  const status = await service.checkSubscriptionActive(AGENT, false);
  assert.equal(status.subscriptionStatus, "expired");
});

Deno.test("Subscription: asesor inexistente → 404, no 402", async () => {
  const { repo, service } = setup();
  repo.agentStatus = null;
  const err = await captureError<AppError>(() => service.checkSubscriptionActive(AGENT, false));
  assert.equal(err.statusCode, 404);
  assert.equal(err.errorCode, "RESOURCE_NOT_FOUND");
});

// ─── getSubscriptionInfo (lo que ve la pantalla de cuenta) ──────────────────

function planInfo(status: string, trialEndsAt: string | null) {
  return { subscriptionStatus: status, trialEndsAt, subscriptionExpiresAt: null, plan: buildPlan() };
}

Deno.test("Subscription info: trial vencido se reporta 'expired' con 0 días restantes", async () => {
  const { repo, service } = setup();
  repo.agentPlan = planInfo("trial", daysFromNow(-2));
  const info = await service.getSubscriptionInfo(AGENT);
  assert.equal(info.status, "expired");
  assert.equal(info.trialDaysRemaining, 0);
});

Deno.test("Subscription info: trial vigente reporta los días que faltan (redondeo hacia arriba)", async () => {
  const { repo, service } = setup();
  repo.agentPlan = planInfo("trial", daysFromNow(2.5));
  const info = await service.getSubscriptionInfo(AGENT);
  assert.equal(info.status, "trial");
  assert.equal(info.trialDaysRemaining, 3);
});

Deno.test("Subscription info: activo no tiene días de trial y trae el uso del mes", async () => {
  const { repo, usageRepo, service } = setup();
  repo.agentPlan = planInfo("active", null);
  usageRepo.monthlyUsage = { chatCount: 12, ingestionCount: 2 };
  const info = await service.getSubscriptionInfo(AGENT);
  assert.equal(info.status, "active");
  assert.equal(info.trialDaysRemaining, null);
  assert.deepEqual(info.usage, { chatMessages: 12, ingestions: 2 });
});

// ─── Código promocional ─────────────────────────────────────────────────────

const PROMO_ERRORS: Array<[string, RegExp]> = [
  ["promo_not_found", /inválido o inactivo/],
  ["promo_expired", /expirado/],
  ["promo_max_uses_reached", /límite de usos/],
  ["promo_already_used", /Ya aplicaste/],
  ["promo_not_applicable", /ya está activa/],
];

for (const [sqlError, message] of PROMO_ERRORS) {
  Deno.test(`Promo: '${sqlError}' de la BD → 400 con mensaje para el asesor`, async () => {
    const { repo, service } = setup();
    repo.promoResult = { data: null, error: { message: sqlError } };
    const err = await captureError<AppError>(() => service.applyPromoCode(AGENT, "X"));
    assert.equal(err.statusCode, 400);
    assert.match(err.message, message);
    assert.equal(err.message.includes(sqlError), false, "no filtra el código interno");
  });
}

Deno.test("Promo: error desconocido → 500 con el detalle solo en internal", async () => {
  const { repo, service } = setup();
  repo.promoResult = { data: null, error: { message: "deadlock detected on promo_codes" } };
  const err = await captureError<AppError>(() => service.applyPromoCode(AGENT, "X"));
  assert.equal(err.statusCode, 500);
  assert.equal(err.message.includes("promo_codes"), false);
  assert.equal(err.internal?.includes("deadlock"), true);
});

Deno.test("Promo: éxito devuelve la nueva fecha de fin del trial", async () => {
  const { repo, service } = setup();
  const ends = daysFromNow(30);
  repo.promoResult = { data: { trial_ends_at: ends }, error: null };
  assert.deepEqual(await service.applyPromoCode(AGENT, "PRUEBA30"), { trialEndsAt: ends });
  assert.deepEqual(repo.promoCalls, [{ agentId: AGENT, code: "PRUEBA30" }]);
});

// Hallazgo: los errores de promo son AppError "pelones" (sin errorCode), en
// contra de RULES §2. El globalErrorHandler les pone VALIDATION_FAILED por el
// 400, así que la app recibe un código válido pero NO puede distinguir
// "expirado" de "ya usado" por código: solo muestra el mensaje en español.
// Arreglarlo exige un código nuevo en backend Y en error_translator.dart.
Deno.test({
  name: "Promo: cada error lleva su propio errorCode estable (RULES §2)",
  ignore: true,
  fn: async () => {
    const { repo, service } = setup();
    repo.promoResult = { data: null, error: { message: "promo_expired" } };
    const err = await captureError<AppError>(() => service.applyPromoCode(AGENT, "X"));
    assert.ok(err.errorCode, "falta errorCode");
  },
});
