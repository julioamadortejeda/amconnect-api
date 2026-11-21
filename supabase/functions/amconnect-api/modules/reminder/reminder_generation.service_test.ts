// Generación de recordatorios automáticos con repositorio falso: qué se
// escribe (plantilla, datos, titular) y cuándo entra un cumpleaños.
import { deepStrictEqual as assertEquals } from "node:assert";
import { todayInTimezone } from "../../shared/datetime.ts";
import { ReminderGenerationService } from "./reminder_generation.service.ts";
import { DEFAULT_DAYS_BEFORE } from "./reminder_generation.constants.ts";
import type {
  CreateReminderData,
  GenerationCatalog,
  InsertedReminderRow,
  IReminderGenerationRepository,
  PolicyScheduleInfo,
} from "./reminder_generation.repository.ts";
import { ReminderSettingResolver, type ReminderSettingService } from "./reminder_setting.service.ts";
import type { ReminderSettingRow } from "./reminder_setting.repository.ts";

const TZ = "-06:00";
const AGENT = "agent-1";
const TYPES = [
  { id: "t-pay", code: "PAYMENT", name: "Payment" },
  { id: "t-ren", code: "RENEWAL", name: "Renewal" },
  { id: "t-ann", code: "ANNIVERSARY", name: "Anniversary" },
  { id: "t-bday", code: "BIRTHDAY", name: "Birthday" },
];

class FakeGenerationRepo implements IReminderGenerationRepository {
  inserted: CreateReminderData[] = [];
  infoCalls: string[] = [];
  constructor(private info: PolicyScheduleInfo | null = null) {}
  findCatalog(): Promise<GenerationCatalog> {
    return Promise.resolve({ createdStatusId: "st-created", types: TYPES });
  }
  findPolicyScheduleInfo(policyId: string): Promise<PolicyScheduleInfo | null> {
    this.infoCalls.push(policyId);
    return Promise.resolve(this.info);
  }
  insertGenerated(rows: CreateReminderData[]): Promise<InsertedReminderRow[]> {
    this.inserted.push(...rows);
    return Promise.resolve(rows.map((r, i) => ({
      id: `r-${i}`,
      typeId: r.typeId,
      occurrenceDate: r.occurrenceDate,
      title: r.title,
      dueDate: r.dueDate,
      isActive: true,
      isNew: true,
    })));
  }
}

const resolver = (rows: ReminderSettingRow[] = []) => new ReminderSettingResolver(rows, TYPES);
const service = (repo: FakeGenerationRepo, locale = "es") =>
  new ReminderGenerationService(repo, {} as ReminderSettingService, locale);

function addDays(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10);
}

/** Misma fecha de calendario, en otro año (para fechas de nacimiento). */
function inYear(ymd: string, year: number): string {
  return `${year}${ymd.slice(4)}`;
}

const today = todayInTimezone(TZ);

// Póliza tal como la entrega el job nocturno: todo en línea.
const rosaPolicy = {
  id: "p-rosa",
  policyNumber: "GMM-2026-10451",
  nextPaymentDate: addDays(today, 3),
  renewalDate: addDays(today, 200),
  endDate: addDays(today, 200),
  startDate: addDays(today, -165),
  branchId: "b-gmm",
  paymentFrequencyMonths: 1,
  contactId: "c-rosa",
  clientName: "Rosa Martínez Hernández",
  productName: "ALFA MEDICAL INTEGRO",
  branchName: "Gastos Médicos Mayores",
  branchCode: "GASTOS_MÉDICOS_MAYOR",
  premium: 2850,
  currencyCode: "MXN",
};

Deno.test("job: el pago guarda plantilla, datos sin idioma y al titular; título de respaldo en el idioma del asesor", async () => {
  const repo = new FakeGenerationRepo();
  const result = await service(repo).generateForPolicy(rosaPolicy, AGENT, TZ, resolver(), "en");

  assertEquals(result.error, undefined);
  assertEquals(repo.infoCalls, []); // el job ya trae todo
  assertEquals(repo.inserted.length, 1);
  const row = repo.inserted[0];
  assertEquals(row.owner, { policyId: "p-rosa", contactId: "c-rosa" });
  assertEquals(row.titleTemplate, "PAYMENT_DUE");
  assertEquals(row.templateData, { dueDate: addDays(today, 3), amount: 2850, currency: "MXN" });
  assertEquals(row.title, "Payment · ALFA MEDICAL INTEGRO · Rosa Martínez Hernández");
  assertEquals(row.occurrenceDate, addDays(today, 3));
});

Deno.test("job: renovación dentro de su ventana, sin monto", async () => {
  const repo = new FakeGenerationRepo();
  const policy = { ...rosaPolicy, nextPaymentDate: addDays(today, 60), renewalDate: addDays(today, 30), endDate: null };
  await service(repo).generateForPolicy(policy, AGENT, TZ, resolver(), "es");
  assertEquals(repo.inserted.map((r) => [r.titleTemplate, r.title, r.templateData]), [
    ["RENEWAL", "Renovación · ALFA MEDICAL INTEGRO · Rosa Martínez Hernández", { dueDate: addDays(today, 30) }],
  ]);
});

Deno.test("confirmación de póliza: sin datos en línea los busca, y usa el idioma del asesor del constructor", async () => {
  const repo = new FakeGenerationRepo({
    branchId: "b-1",
    frequencyMonths: 1,
    contactId: "c-carlos",
    clientName: "Carlos Ramírez Ortega",
    productName: null,
    branchName: "Automóviles",
    branchCode: "AUTOMÓVILES",
    premium: 6200,
    currencyCode: "MXN",
  });
  await service(repo, "en").generateForPolicy(
    { id: "p-carlos", policyNumber: "AUT-2026-77120", nextPaymentDate: addDays(today, 5) },
    AGENT,
    TZ,
    resolver(),
  );
  assertEquals(repo.infoCalls, ["p-carlos"]);
  assertEquals(repo.inserted[0].owner, { policyId: "p-carlos", contactId: "c-carlos" });
  // Sin producto cae al ramo.
  assertEquals(repo.inserted[0].title, "Payment · Automóviles · Carlos Ramírez Ortega");
});

Deno.test("cumpleaños: con el default entra a 2 y a 9 días (antes era 0 = solo el mismo día)", async () => {
  assertEquals(DEFAULT_DAYS_BEFORE.BIRTHDAY >= 9, true);
  for (const days of [0, 2, 9]) {
    const repo = new FakeGenerationRepo();
    const result = await service(repo).generateForContact(
      { id: "c-carlos", fullName: "Carlos Ramírez Ortega", birthdate: inYear(addDays(today, days), 1975) },
      AGENT,
      TZ,
      resolver(),
      "es",
    );
    assertEquals(result.created.length, 1, `a ${days} días`);
    const row = repo.inserted[0];
    assertEquals(row.owner, { contactId: "c-carlos" });
    assertEquals(row.titleTemplate, "BIRTHDAY");
    assertEquals(row.title, "Cumpleaños de Carlos Ramírez Ortega");
    assertEquals(row.templateData, { dueDate: addDays(today, days) });
    assertEquals(row.occurrenceDate, addDays(today, days));
  }
});

Deno.test("cumpleaños: fuera de la ventana no se crea; la ventana del asesor manda", async () => {
  const far = new FakeGenerationRepo();
  await service(far).generateForContact(
    { id: "c-1", fullName: "X", birthdate: inYear(addDays(today, DEFAULT_DAYS_BEFORE.BIRTHDAY + 1), 1980) },
    AGENT,
    TZ,
    resolver(),
  );
  assertEquals(far.inserted.length, 0);

  const custom = new FakeGenerationRepo();
  const settings = resolver([
    { id: "s-1", reminderTypeId: "t-bday", branchId: null, daysBefore: 1, isActive: true },
  ]);
  await service(custom).generateForContact(
    { id: "c-1", fullName: "X", birthdate: inYear(addDays(today, 2), 1980) },
    AGENT,
    TZ,
    settings,
  );
  assertEquals(custom.inserted.length, 0);
});

Deno.test("cumpleaños: si ya pasó este año, la ocurrencia es la del año que entra", async () => {
  // Fecha de nacimiento cuyo día cae antes de hoy en el calendario: la
  // siguiente ocurrencia es el año que entra, nunca una fecha pasada.
  const repo = new FakeGenerationRepo();
  await service(repo).generateForContact(
    { id: "c-1", fullName: "X", birthdate: inYear(addDays(today, -1), 1990) },
    AGENT,
    TZ,
    resolver([{ id: "s", reminderTypeId: "t-bday", branchId: null, daysBefore: 400, isActive: true }]),
  );
  const occurrence = repo.inserted[0].occurrenceDate;
  assertEquals(occurrence > today, true);
  assertEquals(occurrence.slice(5), addDays(today, -1).slice(5));
});
