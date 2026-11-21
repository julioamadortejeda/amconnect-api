import "../../shared/testing/test_env.ts";
import assert from "node:assert/strict";
import { createCatalogServices } from "./catalog.service.ts";
import { FakeSupabase } from "../../shared/testing/fake_supabase.ts";

Deno.test("productService.findByNameInCarrier: filtra por asesor, aseguradora y ramo", async () => {
  const fake = new FakeSupabase({
    products: { data: [{ id: "p1", name: "Alfa", carrier_id: "car-1", branch_id: "br-1" }], error: null },
  });
  const { productService } = createCatalogServices(fake.client, "agent-1");
  const rows = await productService.findByNameInCarrier("Alfa", "car-1", "br-1");
  const q = fake.queriesTo("products")[0];
  assert.equal(q.eq("agent_id"), "agent-1");
  assert.equal(q.eq("carrier_id"), "car-1");
  assert.equal(q.eq("branch_id"), "br-1");
  assert.deepEqual(rows, [{ id: "p1", name: "Alfa", carrierId: "car-1", branchId: "br-1" }]);
});

Deno.test("productService.findByNameInCarrier: sin ramo conocido no filtra por ramo", async () => {
  const fake = new FakeSupabase({ products: { data: [], error: null } });
  const { productService } = createCatalogServices(fake.client, "agent-1");
  await productService.findByNameInCarrier("Alfa", "car-1");
  const q = fake.queriesTo("products")[0];
  assert.equal(q.eq("carrier_id"), "car-1");
  assert.equal(q.eq("branch_id"), undefined);
});
