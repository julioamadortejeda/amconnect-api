export const REMINDER_TITLES: Record<string, (label: string) => string> = {
  PAYMENT: (label) => `Pago de Prima · ${label}`,
  RENEWAL: (label) => `Renovación · ${label}`,
  ANNIVERSARY: (label) => `Aniversario · ${label}`,
  BIRTHDAY: (label) => `Cumpleaños · ${label}`,
};

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
