import "../../../shared/testing/test_env.ts";
import assert from "node:assert/strict";
import { policyDetailResult } from "./policy.mapper.ts";
import { buildPolicy } from "../../../shared/testing/fake_skill_context.ts";

// La póliza trae `product:products(..., carrier:carriers(..), branch:branches(..))`:
// la aseguradora cuelga del producto, no del ramo.
Deno.test("policyDetailResult: la tarjeta policy_info lee la aseguradora de product.carrier", () => {
  const result = policyDetailResult(buildPolicy(), [], []) as { __skillMetadata: Record<string, unknown> };
  assert.equal(result.__skillMetadata.carrierName, "GNP");
  assert.equal(result.__skillMetadata.branchName, "GMM");
  assert.equal(result.__skillMetadata.productName, "Alfa Medical");
});
