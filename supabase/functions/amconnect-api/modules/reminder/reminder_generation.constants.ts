/**
 * Títulos y textos de los recordatorios que genera el cron, por idioma.
 *
 * Viven aquí y no en el prompt ni en la app porque el cron los ESCRIBE en la
 * columna `reminders.title`: cuando el asesor los ve ya son datos, no plantilla.
 * Por eso hay que resolver el idioma al generarlos, y por eso `agents.locale`
 * existe — el cron no tiene request del cual leer `Accept-Language`.
 *
 * Cualquier idioma que no esté aquí cae a español, el default del producto.
 */
const TITLES_BY_LOCALE: Record<string, Record<string, (label: string) => string>> = {
  es: {
    PAYMENT: (label) => `Pago de Prima · ${label}`,
    RENEWAL: (label) => `Renovación · ${label}`,
    ANNIVERSARY: (label) => `Aniversario · ${label}`,
    BIRTHDAY: (label) => `Cumpleaños · ${label}`,
  },
  en: {
    PAYMENT: (label) => `Premium Payment · ${label}`,
    RENEWAL: (label) => `Renewal · ${label}`,
    ANNIVERSARY: (label) => `Anniversary · ${label}`,
    BIRTHDAY: (label) => `Birthday · ${label}`,
  },
};

/** Título del recordatorio generado, en el idioma del asesor. */
export function reminderTitle(typeCode: string, label: string, locale = "es"): string {
  const porIdioma = TITLES_BY_LOCALE[locale] ?? TITLES_BY_LOCALE.es;
  return (porIdioma[typeCode] ?? TITLES_BY_LOCALE.es[typeCode])?.(label) ?? label;
}

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
  BIRTHDAY: 0,
};

/** Months between occurrences for the types whose cadence is fixed yearly. */
export const YEARLY_INTERVAL_MONTHS = 12;
