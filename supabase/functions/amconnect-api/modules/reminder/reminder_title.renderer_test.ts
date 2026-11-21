import { deepStrictEqual as assertEquals } from "node:assert";
import {
  displayTitle,
  formatCalendarDate,
  renderPushText,
  renderReminderTitle,
  toReminderLocale,
} from "./reminder_title.renderer.ts";

const ROSA = {
  productName: "ALFA MEDICAL INTEGRO",
  branchName: "Gastos Médicos Mayores",
  branchCode: "GASTOS_MÉDICOS_MAYOR",
  clientName: "Rosa Martínez Hernández",
  policyNumber: "GMM-2026-10451",
};

Deno.test("renderer: pago con producto y cliente, es/en, sin número de póliza", () => {
  assertEquals(renderReminderTitle("PAYMENT_DUE", ROSA, "es"), "Pago · ALFA MEDICAL INTEGRO · Rosa Martínez Hernández");
  assertEquals(renderReminderTitle("PAYMENT_DUE", ROSA, "en"), "Payment · ALFA MEDICAL INTEGRO · Rosa Martínez Hernández");
});

Deno.test("renderer: renovación y aniversario", () => {
  assertEquals(renderReminderTitle("RENEWAL", ROSA, "es"), "Renovación · ALFA MEDICAL INTEGRO · Rosa Martínez Hernández");
  assertEquals(renderReminderTitle("RENEWAL", ROSA, "en"), "Renewal · ALFA MEDICAL INTEGRO · Rosa Martínez Hernández");
  assertEquals(renderReminderTitle("ANNIVERSARY", ROSA, "en"), "Anniversary · ALFA MEDICAL INTEGRO · Rosa Martínez Hernández");
});

Deno.test("renderer: sin producto cae al ramo; código conocido se traduce, desconocido se queda como lo nombró el asesor", () => {
  const noProduct = { ...ROSA, productName: null };
  assertEquals(renderReminderTitle("PAYMENT_DUE", noProduct, "en"), "Payment · Gastos Médicos Mayores · Rosa Martínez Hernández");
  const known = { ...noProduct, branchCode: "MAJOR_MEDICAL", branchName: "GMM" };
  assertEquals(renderReminderTitle("PAYMENT_DUE", known, "en"), "Payment · Major Medical · Rosa Martínez Hernández");
  assertEquals(renderReminderTitle("PAYMENT_DUE", known, "es"), "Pago · Gastos Médicos Mayores · Rosa Martínez Hernández");
});

Deno.test("renderer: sin producto ni ramo usa el número de póliza; sin nada, solo el tipo", () => {
  assertEquals(
    renderReminderTitle("PAYMENT_DUE", { policyNumber: "GMM-1", clientName: "Rosa" }, "es"),
    "Pago · GMM-1 · Rosa",
  );
  assertEquals(renderReminderTitle("RENEWAL", {}, "en"), "Renewal");
});

Deno.test("renderer: sin cliente omite la parte, no deja separadores colgando", () => {
  assertEquals(renderReminderTitle("PAYMENT_DUE", { ...ROSA, clientName: "  " }, "es"), "Pago · ALFA MEDICAL INTEGRO");
});

Deno.test("renderer: cumpleaños es/en y sin cliente", () => {
  assertEquals(renderReminderTitle("BIRTHDAY", { clientName: "Carlos Ramírez Ortega" }, "es"), "Cumpleaños de Carlos Ramírez Ortega");
  assertEquals(renderReminderTitle("BIRTHDAY", { clientName: "Carlos Ramírez Ortega" }, "en"), "Carlos Ramírez Ortega's birthday");
  assertEquals(renderReminderTitle("BIRTHDAY", {}, "es"), "Cumpleaños");
});

Deno.test("renderer: plantilla desconocida o nula → null; idioma desconocido → español", () => {
  assertEquals(renderReminderTitle(null, ROSA, "es"), null);
  assertEquals(renderReminderTitle("CALL", ROSA, "es"), null);
  assertEquals(renderReminderTitle("PAYMENT_DUE", ROSA, "fr"), "Pago · ALFA MEDICAL INTEGRO · Rosa Martínez Hernández");
  assertEquals(toReminderLocale("en_US"), "en");
  assertEquals(toReminderLocale(null), "es");
});

Deno.test("displayTitle: lee los embeds del DTO; sin plantilla respeta el texto del asesor", () => {
  const dto = {
    title: "Pago de Prima · GMM-2026-10451",
    titleTemplate: "PAYMENT_DUE",
    contact: { fullName: "Rosa Martínez Hernández" },
    policy: { policyNumber: "GMM-2026-10451", product: { name: "ALFA MEDICAL INTEGRO", branch: { name: "GMM", code: null } } },
  };
  assertEquals(displayTitle(dto, "en"), "Payment · ALFA MEDICAL INTEGRO · Rosa Martínez Hernández");
  assertEquals(displayTitle({ ...dto, titleTemplate: null, title: "Cobrarle a Rosa en efectivo" }, "en"), "Cobrarle a Rosa en efectivo");
});

Deno.test("formatCalendarDate: fecha de calendario sin corrimiento de huso", () => {
  assertEquals(formatCalendarDate("2026-11-23", "es"), "23 de noviembre");
  assertEquals(formatCalendarDate("2026-11-23", "en"), "November 23");
  assertEquals(formatCalendarDate("basura", "es"), null);
});

Deno.test("renderPushText: automático lleva fecha y monto en el idioma del asesor", () => {
  const reminder = {
    title: "Pago de Prima · GMM-2026-10451",
    titleTemplate: "PAYMENT_DUE",
    description: null,
    templateData: { dueDate: "2026-11-23", amount: 2850, currency: "MXN" },
    contact: { fullName: "Rosa Martínez Hernández" },
    policy: { policyNumber: "GMM-2026-10451", product: { name: "ALFA MEDICAL INTEGRO" } },
  };
  assertEquals(renderPushText(reminder, "es"), {
    title: "Pago · ALFA MEDICAL INTEGRO · Rosa Martínez Hernández",
    body: "Vence el 23 de noviembre · $2,850.00",
  });
  const en = renderPushText(reminder, "en");
  assertEquals(en.title, "Payment · ALFA MEDICAL INTEGRO · Rosa Martínez Hernández");
  assertEquals(en.body.startsWith("Due November 23 · "), true);
});

Deno.test("renderPushText: cumpleaños y manual", () => {
  assertEquals(
    renderPushText({ title: "x", titleTemplate: "BIRTHDAY", occurrenceDate: "2026-11-22", contact: { fullName: "Carlos" } }, "en"),
    { title: "Carlos's birthday", body: "On November 22" },
  );
  assertEquals(renderPushText({ title: "Llamar a Rosa", description: null }, "es"), {
    title: "Recordatorio: Llamar a Rosa",
    body: "Tienes un recordatorio pendiente.",
  });
  assertEquals(renderPushText({ title: "Llamar a Rosa", description: "Sobre su GMM" }, "en"), {
    title: "Reminder: Llamar a Rosa",
    body: "Sobre su GMM",
  });
});
