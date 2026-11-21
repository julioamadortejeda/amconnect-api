import "../../shared/testing/test_env.ts";
import assert from "node:assert/strict";
import { ConfirmPolicyService, ConfirmPolicySchema } from "./confirm_policy.service.ts";
import { PolicyConfirmationService } from "./policy_confirmation.service.ts";
import { buildPolicy, fakeSkillContext, quiet } from "../../shared/testing/fake_skill_context.ts";

const UUID = "3f1c2a8e-5b7d-4e19-9a0c-2d6f8b1e4c37";

Deno.test("REST confirm-policy: genera los recordatorios automáticos una vez, con el offset del asesor", async () => {
  const policy = buildPolicy({ id: "p-rest" });
  const generated: unknown[][] = [];
  const service = new ConfirmPolicyService(
    // deno-lint-ignore no-explicit-any
    { findByFilters: () => Promise.resolve([]), create: () => Promise.resolve(policy) } as any,
    // deno-lint-ignore no-explicit-any
    { updateNoteLinks: () => Promise.resolve() } as any,
    {
      generateForPolicy: (...a: unknown[]) => {
        generated.push(a);
        return Promise.resolve({ error: "falló" }); // devuelve el error, no lanza
      },
      // deno-lint-ignore no-explicit-any
    } as any,
  );
  const data = ConfirmPolicySchema.parse({
    contactId: UUID, carrierId: UUID, branchId: UUID, productId: UUID, statusId: UUID, currencyId: UUID,
  });
  const result = await service.confirm("agent-1", data, "-05:00");
  assert.deepEqual(generated, [[policy, "agent-1", "-05:00"]]);
  // La forma de la respuesta no cambia, y un fallo de generación no la tumba.
  assert.deepEqual(Object.keys(result), ["policy", "beneficiaries", "participants"]);
});

Deno.test("chat confirm: también genera los recordatorios una vez (mismo resultado que REST)", async () => {
  const { ctx, called } = fakeSkillContext({
    createdPolicy: buildPolicy({ id: "p-chat" }),
    matchingContact: { id: "c-1", fullName: "Julio" },
    policyStatuses: [{ id: "st-1", code: "ACTIVE", name: "Active" }],
    currencies: [{ id: "cur-1", code: "MXN", name: "Peso" }],
  });
  const confirmation = ctx.policyConfirmation as PolicyConfirmationService;
  await quiet(() =>
    confirmation.confirm("agent-1", "s-1", "-05:00", {
      carrierName: "GNP", branchName: "GMM", holderName: "Julio", beneficiaries: [],
    })
  );
  assert.equal(called("reminderGenerationService.generateForPolicy").length, 1);
});
