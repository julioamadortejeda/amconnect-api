// Teléfono legible para lo que LEE EL MODELO (su texto de respuesta lo copia tal cual).
//
// GEMELO de `fmtPhone` en la app Flutter (lib/core/utils/formatters.dart, con sus
// pruebas en test/core/utils/fmt_phone_test.dart). Mismas reglas, mismos casos:
// si cambias una, cambia la otra y sus pruebas.
//
// Solo para presentación al modelo. NUNCA para BD, respuestas REST de la app,
// metadata de tarjetas (la app la formatea sola) ni tel:/WhatsApp.

const TWO_DIGIT_AREAS = new Set(["55", "33", "81"]);

function groupMx(n: string): string {
  if (TWO_DIGIT_AREAS.has(n.slice(0, 2))) return `${n.slice(0, 2)} ${n.slice(2, 6)} ${n.slice(6)}`;
  return `${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`;
}

/** null/undefined/vacío → "". Formato no reconocido → el texto recortado, sin cambios. */
export function formatPhoneForDisplay(raw: string | null | undefined): string {
  const input = raw?.trim() ?? "";
  if (input === "") return "";
  if (!/^\+?[\d\s\-.()]+$/.test(input)) return input;
  const hasPlus = input.startsWith("+");
  const digits = input.replace(/\D/g, "");

  if (hasPlus) {
    if (digits.startsWith("52")) {
      let national = digits.slice(2);
      if (national.length === 11 && national.startsWith("1")) national = national.slice(1); // móvil legacy
      if (national.length === 10) return `+52 ${groupMx(national)}`;
    } else if (digits.startsWith("1") && digits.length === 11) {
      const n = digits.slice(1);
      return `+1 ${n.slice(0, 3)} ${n.slice(3, 6)} ${n.slice(6)}`;
    }
    return input;
  }
  if (digits.length === 10) return groupMx(digits);
  return input;
}

/** Igual, pero conserva null para campos anulables (el modelo ve null, no ""). */
export function formatPhoneOrNull(raw: string | null | undefined): string | null {
  const out = formatPhoneForDisplay(raw);
  return out === "" ? null : out;
}
