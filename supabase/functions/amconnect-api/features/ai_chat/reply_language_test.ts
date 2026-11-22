import assert from "node:assert/strict";
import { detectReplyLanguage, type ReplyLanguage } from "./reply_language.ts";

const detect = (m: string, fb: ReplyLanguage = "Spanish") => detectReplyLanguage(m, fb);

const SPANISH = [
  "¿Cuál es el teléfono de Rosa?",
  "dame las pólizas de mi cliente",
  "Busca a Rosa y agéndame una llamada el lunes",
  "¿Qué recordatorios tengo para esta semana?",
  "Cuándo vence la póliza de gastos médicos de Julio",
  "recuérdame llamar a Julio mañana",
  "¡Hola! necesito ver los pendientes de hoy",
  "muéstrame todos los clientes",
  "Qué dijo Rosa sobre su mamá",
  "tengo una cita con el cliente el viernes",
];
const ENGLISH = [
  "What is Rosa's phone number?",
  "show me the policies of my client",
  "Find Rosa and schedule a call on Monday",
  "Which reminders do I have for this week?",
  "When does the medical policy of Julio expire?",
  "remind me to call Julio tomorrow",
  "Hello, I need to see the pending tasks for today",
  "give me all the clients",
  "What did Rosa say about her mother",
  "I have a meeting with the client on Friday",
];

for (const m of SPANISH) {
  Deno.test(`detectReplyLanguage: español claro (fallback English) -> Spanish: ${m}`, () => {
    assert.deepEqual(detect(m, "English"), { language: "Spanish", source: "detected" });
  });
}
for (const m of ENGLISH) {
  Deno.test(`detectReplyLanguage: inglés claro (fallback Spanish) -> English: ${m}`, () => {
    assert.deepEqual(detect(m, "Spanish"), { language: "English", source: "detected" });
  });
}

for (const m of ["ok", "sí", "si", "gracias", "thanks", "yes", "Rosa", "123", "", "   ", "👍", "GMM 5512345678"]) {
  for (const fb of ["Spanish", "English"] as const) {
    Deno.test(`detectReplyLanguage: corto/ambiguo "${m}" -> fallback ${fb}`, () => {
      assert.deepEqual(detect(m, fb), { language: fb, source: "fallback" });
    });
  }
}

Deno.test("detectReplyLanguage: acentos y ¿¡ cuentan como evidencia de español", () => {
  assert.equal(detect("¿Dónde?", "English").language, "Spanish");
  assert.equal(detect("¡Listo! años", "English").language, "Spanish");
});

Deno.test("detectReplyLanguage: mezcla con clara mayoría gana la mayoría", () => {
  assert.equal(detect("dame el meeting de Rosa para el lunes", "English").language, "Spanish");
  assert.equal(detect("show me the póliza of my client please", "Spanish").language, "English");
});

Deno.test("detectReplyLanguage: mezcla empatada o de un solo voto -> fallback", () => {
  assert.deepEqual(detect("el client", "English"), { language: "English", source: "fallback" });
  assert.deepEqual(detect("show la", "Spanish"), { language: "Spanish", source: "fallback" });
});

Deno.test("detectReplyLanguage: insensible a mayúsculas y puntuación", () => {
  assert.equal(detect("WHAT IS THE NUMBER???", "Spanish").language, "English");
  assert.equal(detect("DAME LOS CLIENTES!!!", "English").language, "Spanish");
});

Deno.test("detectReplyLanguage: es pura", () => {
  assert.deepEqual(detect("show me the clients"), detect("show me the clients"));
});
