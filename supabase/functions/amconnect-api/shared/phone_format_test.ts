// Espejo de test/core/utils/fmt_phone_test.dart (app). Mantener en sincronía.
import { assertEquals } from "jsr:@std/assert";
import { formatPhoneForDisplay as f, formatPhoneOrNull } from "./phone_format.ts";

Deno.test("null y vacío → cadena vacía", () => {
  assertEquals(f(null), "");
  assertEquals(f(undefined), "");
  assertEquals(f(""), "");
  assertEquals(f("   "), "");
  assertEquals(formatPhoneOrNull(null), null);
  assertEquals(formatPhoneOrNull("8180000101"), "81 8000 0101");
});

Deno.test("México con +52, ladas 55/33/81 en 2-4-4", () => {
  assertEquals(f("+525512340011"), "+52 55 1234 0011");
  assertEquals(f("+523312345678"), "+52 33 1234 5678");
  assertEquals(f("+528112345678"), "+52 81 1234 5678");
});

Deno.test("México con otras ladas en 3-3-4", () => {
  assertEquals(f("+522221234567"), "+52 222 123 4567");
});

Deno.test("prefijo móvil legacy +521 se descarta", () => {
  assertEquals(f("+5215512340011"), "+52 55 1234 0011");
  assertEquals(f("+5212221234567"), "+52 222 123 4567");
});

Deno.test("10 dígitos sin país", () => {
  assertEquals(f("5512340011"), "55 1234 0011");
  assertEquals(f("2221234567"), "222 123 4567");
  assertEquals(f("8180000101"), "81 8000 0101");
});

Deno.test("ignora espacios, guiones, puntos y paréntesis", () => {
  assertEquals(f("+52 (55) 1234-0011"), "+52 55 1234 0011");
  assertEquals(f("(222) 123.4567"), "222 123 4567");
  assertEquals(f("  55-1234-0011 "), "55 1234 0011");
});

Deno.test("EE. UU./Canadá", () => {
  assertEquals(f("+14155550123"), "+1 415 555 0123");
  assertEquals(f("+1 (415) 555-0123"), "+1 415 555 0123");
});

Deno.test("otros formatos se devuelven igual (recortados)", () => {
  assertEquals(f("+34612345678"), "+34612345678");
  assertEquals(f(" +44 20 7946 0958 "), "+44 20 7946 0958");
  assertEquals(f("5512340011 ext 5"), "5512340011 ext 5");
  assertEquals(f("55123"), "55123");
  assertEquals(f("+52551234"), "+52551234");
  assertEquals(f("abc"), "abc");
});
