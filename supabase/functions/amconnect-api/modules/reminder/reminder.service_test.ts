// ReminderService: el título de los automáticos se arma al leer en el idioma
// del asesor, y editarlo lo convierte en texto del asesor (D-021/D-023).
import { deepStrictEqual as assertEquals } from "node:assert";
import { ReminderService } from "./reminder.service.ts";
import type { ReminderRepository } from "./reminder.repository.ts";

// Fila tal como la devuelve PostgREST (snake_case, con embeds).
const rosaRow = () => ({
  id: "r-1",
  agent_id: "agent-1",
  contact_id: "c-rosa",
  policy_id: "p-rosa",
  type_id: "t-pay",
  title: "Pago de Prima · GMM-2026-10451",
  title_template: "PAYMENT_DUE",
  template_data: { dueDate: "2026-11-23" },
  description: null,
  due_date: "2026-11-23T06:00:00+00:00",
  status_id: "st-1",
  contact: { id: "c-rosa", full_name: "Rosa Martínez Hernández" },
  policy: { id: "p-rosa", policy_number: "GMM-2026-10451", product: { name: "ALFA MEDICAL INTEGRO", branch: null } },
});

function fakeRepo(row: Record<string, unknown>) {
  const updates: Array<{ id: string; payload: Record<string, unknown> }> = [];
  const repo = {
    getById: () => Promise.resolve(row),
    update: (id: string, payload: Record<string, unknown>) => {
      updates.push({ id, payload });
      return Promise.resolve(row);
    },
    paginate: () => Promise.resolve({ data: [row], total: 1, page: 1, pageSize: 20 }),
  } as unknown as ReminderRepository;
  return { repo, updates };
}

Deno.test("ReminderService: el título del automático sale en el idioma del asesor, con producto y cliente", async () => {
  const { repo } = fakeRepo(rosaRow());
  assertEquals((await new ReminderService(repo, "en").getById("r-1"))?.title, "Payment · ALFA MEDICAL INTEGRO · Rosa Martínez Hernández");
  assertEquals((await new ReminderService(repo, "es").getById("r-1"))?.title, "Pago · ALFA MEDICAL INTEGRO · Rosa Martínez Hernández");
  const page = await new ReminderService(repo, "es").paginate({}, 1, 20);
  assertEquals(page.data[0].title, "Pago · ALFA MEDICAL INTEGRO · Rosa Martínez Hernández");
  assertEquals(page.data[0].contact?.fullName, "Rosa Martínez Hernández");
});

Deno.test("ReminderService: uno manual conserva el texto del asesor", async () => {
  const { repo } = fakeRepo({ ...rosaRow(), title: "Cobrarle a Rosa en efectivo", title_template: null });
  assertEquals((await new ReminderService(repo, "en").getById("r-1"))?.title, "Cobrarle a Rosa en efectivo");
});

Deno.test("ReminderService.update: editar el título borra la plantilla; mandar el mismo título no", async () => {
  const edited = fakeRepo(rosaRow());
  await new ReminderService(edited.repo, "es").update("r-1", { title: "Cobrar a Rosa el lunes" });
  assertEquals(edited.updates, [{ id: "r-1", payload: { title: "Cobrar a Rosa el lunes", title_template: null } }]);

  // La app manda el formulario completo al reagendar: el título que ve no es una edición.
  const resent = fakeRepo(rosaRow());
  await new ReminderService(resent.repo, "es").update("r-1", {
    title: "Pago · ALFA MEDICAL INTEGRO · Rosa Martínez Hernández",
    dueDate: "2026-11-24T06:00:00+00:00",
  });
  assertEquals(resent.updates.length, 1);
  assertEquals("title" in resent.updates[0].payload, false);
  assertEquals("title_template" in resent.updates[0].payload, false);
});
