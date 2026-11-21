/**
 * Textos de los recordatorios que genera el cron.
 *
 * El TÍTULO ya no vive aquí: desde D-023 se guarda como plantilla
 * (`title_template` + `template_data`) y se arma al leerlo en el idioma del
 * asesor — ver `reminder_title.renderer.ts`. La descripción de fecha estimada
 * sigue congelada al crearse: es una nota única por ocurrencia y el asesor
 * puede editarla como cualquier otro texto suyo.
 */

/**
 * Lo que se escribe en la descripción cuando la fecha del pago NO venía en la
 * carátula y se calculó desde el inicio de la póliza. El asesor tiene que poder
 * distinguir un dato leído de uno deducido antes de llamarle a un cliente.
 */
const ESTIMATED_NOTE: Record<string, string> = {
  es: "Fecha estimada a partir del inicio de la póliza y su frecuencia de pago — la carátula no traía la fecha del próximo pago. Confírmala con la aseguradora.",
  en: "Date estimated from the policy start date and its payment frequency — the policy document did not state the next payment date. Confirm it with the carrier.",
};

export function estimatedDateNote(locale = "es"): string {
  return ESTIMATED_NOTE[locale] ?? ESTIMATED_NOTE.es;
}

/** The reminder types the daily job creates on its own, in the order shown in settings. */
export const GENERATED_REMINDER_TYPE_CODES = [
  "PAYMENT",
  "RENEWAL",
  "ANNIVERSARY",
  "BIRTHDAY",
] as const;

/**
 * How many days ahead each type warns when the advisor has not configured it.
 * These are the effective values out of the box — `reminder_settings` only
 * stores a row once the advisor changes something.
 */
export const DEFAULT_DAYS_BEFORE: Record<string, number> = {
  PAYMENT: 15,
  RENEWAL: 45,
  ANNIVERSARY: 7,
  // Era 0 ("el mismo día"): el recordatorio se creaba la mañana del cumpleaños
  // y nunca antes, así que un cumpleaños a 2 o a 9 días no aparecía en la
  // agenda (prueba de la asesora, 2026-11-20). Para felicitar o mandar un
  // detalle hace falta verlo con anticipación. Mismo margen que el pago.
  BIRTHDAY: 15,
};

/** Months between occurrences for the types whose cadence is fixed yearly. */
export const YEARLY_INTERVAL_MONTHS = 12;
