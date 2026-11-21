import "../../shared/testing/test_env.ts";
import assert from "node:assert/strict";
import { executeSkill } from "../ai_chat/skills/skill_executor.ts";
import { buildPolicy, fakeSkillContext, quiet } from "../../shared/testing/fake_skill_context.ts";

const args = { carrier_name: "GNP", branch_name: "GMM", holder_name: "Julio", product_name: "Alfa" };
const base = {
  createdPolicy: buildPolicy({ id: "p-new" }),
  matchingContact: { id: "c-1", fullName: "Julio" },
  catalogSearch: { carrier: [{ id: "car-1", name: "GNP" }], branch: [{ id: "br-1", name: "GMM" }] },
  policyStatuses: [{ id: "st-1", code: "ACTIVE", name: "Active" }],
  currencies: [{ id: "cur-1", code: "MXN", name: "Peso" }],
};

Deno.test("confirmar póliza: busca el producto por nombre DENTRO de la aseguradora y ramo resueltos", async () => {
  const { ctx, called } = fakeSkillContext({ ...base, catalogSearch: { ...base.catalogSearch, product: [{ id: "prod-gnp" }] } });
  await quiet(() => executeSkill("confirm_policy_ingestion", args, ctx));
  assert.deepEqual(called("catalog.product.findByNameInCarrier"), [["Alfa", "car-1", "br-1"]]);
  assert.equal(called("catalog.product.search").length, 0);
  assert.equal(called("catalog.product.create").length, 0);
  assert.equal((called("policyService.create")[0][0] as { productId: string }).productId, "prod-gnp");
});

Deno.test("confirmar póliza: si la aseguradora no tiene ese producto, lo crea (no reutiliza el de otra)", async () => {
  const { ctx, called } = fakeSkillContext(base);
  await quiet(() => executeSkill("confirm_policy_ingestion", args, ctx));
  assert.deepEqual(called("catalog.product.create"), [[{ name: "Alfa", carrierId: "car-1", branchId: "br-1" }]]);
});
