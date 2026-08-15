// Recurrence math for policy-driven reminders (payments, renewals, anniversaries,
// birthdays). All of them are the same shape: an anchor date plus a fixed interval
// in months. Reminders are generated on demand, so nothing is ever materialised —
// the next occurrence is always derived from the anchor, never from the previous one.
//
// Deriving from the anchor (and not from the previous occurrence) is what keeps a
// policy paid on the 31st from drifting to the 28th forever after hitting February.

/** A recurring day of the year, e.g. { month: 11, day: 10 } = November 10th. */
export interface ScheduleRuleDay {
  month: number; // 1-12
  day: number; // 1-31, as written in the anchor (not clamped)
}

export interface PaymentSchedule {
  /** Months between occurrences: 1 monthly, 3 quarterly, 6 semi-annual, 12 annual. */
  frequencyMonths: number;
  /**
   * The timeless rule, for display: "pays on May 10 and Nov 10".
   * Empty when the interval does not divide the year evenly, since then the
   * calendar days shift from one year to the next and there is no stable rule.
   */
  ruleDays: ScheduleRuleDay[];
  /** First occurrence on or after the reference date, as YYYY-MM-DD. */
  nextPaymentDate: string;
}

interface YMD {
  y: number;
  m: number; // 1-12
  d: number;
}

/** Parses the YYYY-MM-DD prefix of a date string without timezone interpretation. */
function parseYmd(dateStr: string): YMD | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})/.exec(dateStr);
  if (!match) return null;
  return { y: Number(match[1]), m: Number(match[2]), d: Number(match[3]) };
}

function formatYmd(ymd: YMD): string {
  const mm = String(ymd.m).padStart(2, "0");
  const dd = String(ymd.d).padStart(2, "0");
  return `${ymd.y}-${mm}-${dd}`;
}

function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

/** Absolute month index, so month arithmetic never has to wrap by hand. */
function monthIndex(ymd: YMD): number {
  return ymd.y * 12 + (ymd.m - 1);
}

/**
 * Shifts an anchor by N months, keeping the anchor's day-of-month and clamping
 * to the last day when the target month is shorter (Jan 31 + 1 month = Feb 28).
 */
function addMonths(anchor: YMD, months: number): YMD {
  const total = monthIndex(anchor) + months;
  const y = Math.floor(total / 12);
  const m = (total % 12) + 1;
  return { y, m, d: Math.min(anchor.d, daysInMonth(y, m)) };
}

function isOnOrAfter(a: YMD, b: YMD): boolean {
  if (a.y !== b.y) return a.y > b.y;
  if (a.m !== b.m) return a.m > b.m;
  return a.d >= b.d;
}

/**
 * First occurrence of the series on or after `from`. The anchor may sit in the
 * past or the future — a stale `next_payment_date` from years ago still yields
 * the correct upcoming date.
 *
 * Returns null when the inputs are unusable.
 */
export function nextOccurrence(
  anchorDate: string,
  intervalMonths: number,
  from: string,
): string | null {
  const anchor = parseYmd(anchorDate);
  const reference = parseYmd(from);
  if (!anchor || !reference || intervalMonths <= 0) return null;

  const monthsApart = monthIndex(reference) - monthIndex(anchor);
  let steps = Math.ceil(monthsApart / intervalMonths);

  // Day-of-month can push the candidate just before the reference (or leave the
  // previous step still valid), so settle it with at most one nudge either way.
  let candidate = addMonths(anchor, steps * intervalMonths);
  if (!isOnOrAfter(candidate, reference)) {
    steps += 1;
    candidate = addMonths(anchor, steps * intervalMonths);
  } else {
    const previous = addMonths(anchor, (steps - 1) * intervalMonths);
    if (isOnOrAfter(previous, reference)) candidate = previous;
  }

  return formatYmd(candidate);
}

/**
 * The recurring calendar days implied by the anchor, sorted by month.
 * Nov 10 semi-annual → [May 10, Nov 10]. Nov 10 annual → [Nov 10].
 */
export function buildRuleDays(anchorDate: string, intervalMonths: number): ScheduleRuleDay[] {
  const anchor = parseYmd(anchorDate);
  if (!anchor || intervalMonths <= 0) return [];
  // An interval that does not divide the year has no fixed set of calendar days.
  if (12 % intervalMonths !== 0) return [];

  const days: ScheduleRuleDay[] = [];
  for (let step = 0; step < 12 / intervalMonths; step++) {
    const occurrence = addMonths(anchor, step * intervalMonths);
    days.push({ month: occurrence.m, day: anchor.d });
  }
  return days.sort((a, b) => a.month - b.month);
}

/** Everything a client needs to render the schedule, computed server-side. */
export function buildPaymentSchedule(
  anchorDate: string | null | undefined,
  intervalMonths: number | null | undefined,
  from: string,
): PaymentSchedule | null {
  if (!anchorDate) return null;
  const months = intervalMonths && intervalMonths > 0 ? intervalMonths : 12;
  const next = nextOccurrence(anchorDate, months, from);
  if (!next) return null;

  return {
    frequencyMonths: months,
    ruleDays: buildRuleDays(anchorDate, months),
    nextPaymentDate: next,
  };
}

/** Whole days from `from` to `target`; negative when the target is in the past. */
export function daysUntil(target: string, from: string): number | null {
  const a = parseYmd(target);
  const b = parseYmd(from);
  if (!a || !b) return null;
  const targetUtc = Date.UTC(a.y, a.m - 1, a.d);
  const fromUtc = Date.UTC(b.y, b.m - 1, b.d);
  return Math.round((targetUtc - fromUtc) / 86_400_000);
}
