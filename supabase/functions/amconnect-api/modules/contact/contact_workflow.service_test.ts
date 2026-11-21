import "../../shared/testing/test_env.ts";
import assert from "node:assert/strict";
import { ContactWorkflowService } from "./contact_workflow.service.ts";
import { AiInvokedError, AiProviderError } from "../../shared/errors.ts";

function setup(ingest: () => Promise<unknown>) {
  const refunds: Array<string | null> = [];
  const service = new ContactWorkflowService(
    // deno-lint-ignore no-explicit-any
    {} as any,
    {
      checkAndIncrementIngestion: () => Promise.resolve("chg-9"),
      refundCharge: (id: string | null) => {
        refunds.push(id);
        return Promise.resolve();
      },
    },
    // deno-lint-ignore no-explicit-any
    { ingestText: ingest } as any,
  );
  return { service, refunds };
}

const LONG = "x".repeat(400);

Deno.test("addNote: ingesta exitosa → no devuelve la cuota", async () => {
  const { service, refunds } = setup(() => Promise.resolve({ noteId: "n" }));
  await service.addNote("a", "s", "c", LONG);
  assert.deepEqual(refunds, []);
});

Deno.test("addNote: la ingesta falla → devuelve ESE cobro y el error se propaga", async () => {
  const boom = new AiProviderError("proveedor caído");
  const { service, refunds } = setup(() => Promise.reject(boom));
  await assert.rejects(() => service.addNote("a", "s", "c", LONG), (e) => e === boom);
  assert.deepEqual(refunds, ["chg-9"]);
});

Deno.test("addNote: nota corta que falla → no hubo cobro, devuelve null (no-op) y propaga", async () => {
  const { service, refunds } = setup(() => Promise.reject(new Error("db")));
  await assert.rejects(() => service.addNote("a", "s", "c", "corta"), /db/);
  assert.deepEqual(refunds, [null]);
});

Deno.test("addNote: AiInvokedError (la IA ya gastó tokens) → el cobro se queda", async () => {
  const { service, refunds } = setup(() => Promise.reject(new AiInvokedError("ya corrió")));
  await assert.rejects(() => service.addNote("a", "s", "c", LONG), AiInvokedError);
  assert.deepEqual(refunds, []);
});
