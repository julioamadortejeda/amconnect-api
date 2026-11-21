/**
 * Texto de los recordatorios automáticos, armado AL LEERLOS en el idioma del
 * asesor (D-023 + D-024).
 *
 * El job nocturno ya no congela el título: guarda una plantilla
 * (`reminders.title_template`) y datos que no dependen del idioma
 * (`template_data`: fecha, monto). Producto, ramo y cliente se leen de la
 * póliza y del contacto en el momento de mostrarlo, así que si el asesor
 * corrige un nombre o cambia de idioma, sus recordatorios lo siguen.
 *
 * Es el ÚNICO lugar con estas palabras: lo usan la API REST, las skills del
 * asistente (vía ReminderService) y el push. Puro y sin dependencias para que
 * se pruebe sin red.
 *
 * Qué se muestra (la asesora, 2026-11-20): producto + cliente, no el número de
 * póliza — con el número no identifica de quién es.
 *   es  "Pago · ALFA MEDICAL INTEGRO · Rosa Martínez Hernández"
 *   en  "Payment · ALFA MEDICAL INTEGRO · Rosa Martínez Hernández"
 */

export type ReminderLocale = "es" | "en";

/** Plantillas que el job sabe escribir. Lo demás en la columna se ignora. */
export const REMINDER_TITLE_TEMPLATES = ["PAYMENT_DUE", "RENEWAL", "ANNIVERSARY", "BIRTHDAY"] as const;
export type ReminderTitleTemplate = typeof REMINDER_TITLE_TEMPLATES[number];

/** Tipo de recordatorio (catálogo) → plantilla de su título. */
export const TEMPLATE_BY_TYPE_CODE: Record<string, ReminderTitleTemplate> = {
  PAYMENT: "PAYMENT_DUE",
  RENEWAL: "RENEWAL",
  ANNIVERSARY: "ANNIVERSARY",
  BIRTHDAY: "BIRTHDAY",
};

/** Lo que el título necesita leer de la póliza y del contacto. */
export interface ReminderTitleParts {
  productName?: string | null;
  branchName?: string | null;
  branchCode?: string | null;
  clientName?: string | null;
  /** Último recurso, solo si no hay producto ni ramo. */
  policyNumber?: string | null;
}

/** Datos guardados en `template_data`. Nombres en inglés, como todo en la BD. */
export interface ReminderTemplateData {
  /** Fecha de la ocurrencia, YYYY-MM-DD. */
  dueDate?: string;
  amount?: number;
  /** Código ISO de la moneda (MXN, USD). */
  currency?: string;
}

const TYPE_WORD: Record<ReminderLocale, Record<Exclude<ReminderTitleTemplate, "BIRTHDAY">, string>> = {
  es: { PAYMENT_DUE: "Pago", RENEWAL: "Renovación", ANNIVERSARY: "Aniversario" },
  en: { PAYMENT_DUE: "Payment", RENEWAL: "Renewal", ANNIVERSARY: "Anniversary" },
};

const BIRTHDAY: Record<ReminderLocale, { withName: (name: string) => string; bare: string }> = {
  es: { withName: (name) => `Cumpleaños de ${name}`, bare: "Cumpleaños" },
  en: { withName: (name) => `${name}'s birthday`, bare: "Birthday" },
};

/**
 * Ramos con código conocido. Los catálogos son por asesor y cada quien nombra
 * sus ramos como quiere; solo cuando el código es uno de estos se traduce. Si
 * no, se muestra el nombre tal como el asesor lo capturó (D-021). Los nombres
 * de producto son nombres propios y nunca se traducen.
 */
const BRANCH_BY_CODE: Record<string, Record<ReminderLocale, string>> = {
  MAJOR_MEDICAL: { es: "Gastos Médicos Mayores", en: "Major Medical" },
  AUTO: { es: "Autos", en: "Auto" },
  LIFE: { es: "Vida", en: "Life" },
  PROPERTY: { es: "Daños", en: "Property" },
  LIABILITY: { es: "Responsabilidad Civil", en: "Liability" },
  RETIREMENT: { es: "Retiro", en: "Retirement" },
  EDUCATION: { es: "Educación", en: "Education" },
};

const SEPARATOR = " · ";

/** 'es' | 'en' de cualquier valor; lo desconocido cae a español (default del producto). */
export function toReminderLocale(locale?: string | null): ReminderLocale {
  const lang = (locale ?? "").split(/[-_]/)[0].trim().toLowerCase();
  return lang === "en" ? "en" : "es";
}

export function isReminderTitleTemplate(value: unknown): value is ReminderTitleTemplate {
  return typeof value === "string" && (REMINDER_TITLE_TEMPLATES as readonly string[]).includes(value);
}

function clean(value?: string | null): string | null {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

function branchLabel(parts: ReminderTitleParts, locale: ReminderLocale): string | null {
  const code = clean(parts.branchCode)?.toUpperCase();
  if (code && BRANCH_BY_CODE[code]) return BRANCH_BY_CODE[code][locale];
  return clean(parts.branchName);
}

/** Producto si lo hay; si no, el ramo; si tampoco, el número de póliza. */
function productLabel(parts: ReminderTitleParts, locale: ReminderLocale): string | null {
  return clean(parts.productName) ?? branchLabel(parts, locale) ?? clean(parts.policyNumber);
}

/**
 * El título en el idioma pedido, o null si la plantilla no es una conocida
 * (quien llama conserva entonces el título guardado).
 */
export function renderReminderTitle(
  template: string | null | undefined,
  parts: ReminderTitleParts,
  locale?: string | null,
): string | null {
  if (!isReminderTitleTemplate(template)) return null;
  const lang = toReminderLocale(locale);
  const client = clean(parts.clientName);

  if (template === "BIRTHDAY") {
    return client ? BIRTHDAY[lang].withName(client) : BIRTHDAY[lang].bare;
  }

  return [TYPE_WORD[lang][template], productLabel(parts, lang), client]
    .filter((p): p is string => !!p)
    .join(SEPARATOR);
}

/** Forma (camelCase) de un recordatorio con sus embeds, tal como sale de ReminderService. */
export interface RenderableReminder {
  title: string;
  titleTemplate?: string | null;
  contact?: { fullName?: string | null } | null;
  policy?: {
    policyNumber?: string | null;
    product?: { name?: string | null; branch?: { name?: string | null; code?: string | null } | null } | null;
  } | null;
}

/** Las partes del título a partir de los embeds del recordatorio. */
export function titlePartsOf(reminder: RenderableReminder): ReminderTitleParts {
  return {
    productName: reminder.policy?.product?.name,
    branchName: reminder.policy?.product?.branch?.name,
    branchCode: reminder.policy?.product?.branch?.code,
    clientName: reminder.contact?.fullName,
    policyNumber: reminder.policy?.policyNumber,
  };
}

/** Título a mostrar: el de la plantilla si la tiene, si no el que escribió el asesor. */
export function displayTitle(reminder: RenderableReminder, locale?: string | null): string {
  return renderReminderTitle(reminder.titleTemplate, titlePartsOf(reminder), locale) ?? reminder.title;
}

// ─── Push ────────────────────────────────────────────────────────────────────

const INTL_TAG: Record<ReminderLocale, string> = { es: "es-MX", en: "en-US" };

const PUSH: Record<ReminderLocale, {
  manualTitle: (title: string) => string;
  fallbackBody: string;
  due: (date: string) => string;
  birthday: (date: string) => string;
}> = {
  es: {
    manualTitle: (title) => `Recordatorio: ${title}`,
    fallbackBody: "Tienes un recordatorio pendiente.",
    due: (date) => `Vence el ${date}`,
    birthday: (date) => `Es el ${date}`,
  },
  en: {
    manualTitle: (title) => `Reminder: ${title}`,
    fallbackBody: "You have a pending reminder.",
    due: (date) => `Due ${date}`,
    birthday: (date) => `On ${date}`,
  },
};

/** "23 de noviembre" / "November 23". La fecha es de calendario: sin huso. */
export function formatCalendarDate(ymd: string, locale?: string | null): string | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(ymd);
  if (!m) return null;
  const date = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3])));
  try {
    return new Intl.DateTimeFormat(INTL_TAG[toReminderLocale(locale)], {
      day: "numeric",
      month: "long",
      timeZone: "UTC",
    }).format(date);
  } catch (_) {
    return ymd.slice(0, 10);
  }
}

function formatAmount(amount: number, currency: string | undefined, locale: ReminderLocale): string | null {
  if (!Number.isFinite(amount)) return null;
  try {
    return currency
      ? new Intl.NumberFormat(INTL_TAG[locale], { style: "currency", currency }).format(amount)
      : new Intl.NumberFormat(INTL_TAG[locale], { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(amount);
  } catch (_) {
    return `${amount.toFixed(2)}${currency ? ` ${currency}` : ""}`;
  }
}

export interface PushText {
  title: string;
  body: string;
}

/**
 * Texto del push en el idioma del asesor. Uno automático ya se explica solo
 * ("Pago · producto · cliente") y su cuerpo lleva la fecha y el monto; uno
 * manual conserva su forma de siempre con lo que escribió el asesor.
 */
export function renderPushText(
  reminder: RenderableReminder & {
    description?: string | null;
    templateData?: ReminderTemplateData | null;
    occurrenceDate?: string | null;
  },
  locale?: string | null,
): PushText {
  const lang = toReminderLocale(locale);
  const text = PUSH[lang];
  const rendered = renderReminderTitle(reminder.titleTemplate, titlePartsOf(reminder), lang);

  if (!rendered) {
    return {
      title: text.manualTitle(reminder.title),
      body: clean(reminder.description) ?? text.fallbackBody,
    };
  }

  const data = reminder.templateData ?? {};
  const ymd = data.dueDate ?? reminder.occurrenceDate ?? null;
  const date = ymd ? formatCalendarDate(ymd, lang) : null;
  const pieces: string[] = [];
  if (date) pieces.push(reminder.titleTemplate === "BIRTHDAY" ? text.birthday(date) : text.due(date));
  if (typeof data.amount === "number") {
    const amount = formatAmount(data.amount, data.currency, lang);
    if (amount) pieces.push(amount);
  }

  return { title: rendered, body: pieces.length > 0 ? pieces.join(SEPARATOR) : text.fallbackBody };
}
