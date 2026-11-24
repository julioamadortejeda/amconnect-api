import assert from "node:assert/strict";
import { nextDaysLine, weekdayInTimezone, weekdayOfLocalDate } from "./weekday.ts";

Deno.test("weekdayOfLocalDate: los casos que el modelo fallaba", () => {
  assert.equal(weekdayOfLocalDate("2026-11-27"), "Friday");
  assert.equal(weekdayOfLocalDate("2026-11-24"), "Tuesday");
  assert.equal(weekdayOfLocalDate("2026-11-23"), "Monday");
  // ISO local con hora y offset: solo cuenta la fecha local.
  assert.equal(weekdayOfLocalDate("2026-11-23T23:30:00-06:00"), "Monday");
  assert.equal(weekdayOfLocalDate("basura"), null);
  assert.equal(weekdayOfLocalDate(null), null);
});

Deno.test("weekdayInTimezone: 23:30 locales del lunes ya es martes en UTC", () => {
  const instant = "2026-11-24T05:30:00+00:00"; // lunes 23:30 en CDMX
  assert.equal(weekdayInTimezone(instant, "America/Mexico_City"), "Monday");
  assert.equal(weekdayInTimezone(instant, "UTC"), "Tuesday");
  // Zona distinta a México, al este de UTC: ya es martes 14:30 en Tokio.
  assert.equal(weekdayInTimezone(instant, "Asia/Tokyo"), "Tuesday");
  // 20:00 UTC del lunes es todavía lunes en CDMX y ya martes 05:00 en Tokio.
  assert.equal(weekdayInTimezone("2026-11-23T20:00:00Z", "America/Mexico_City"), "Monday");
  assert.equal(weekdayInTimezone("2026-11-23T20:00:00Z", "Asia/Tokyo"), "Tuesday");
  assert.equal(weekdayInTimezone("no-fecha", "UTC"), null);
  assert.equal(weekdayInTimezone("2026-11-23T20:00:00Z", "Not/AZone"), null);
});

Deno.test("nextDaysLine: 7 días siguientes, cruzando fin de mes y de año", () => {
  assert.equal(
    nextDaysLine("2026-11-23"),
    "Tue 2026-11-24, Wed 2026-11-25, Thu 2026-11-26, Fri 2026-11-27, Sat 2026-11-28, Sun 2026-11-29, Mon 2026-11-30",
  );
  assert.equal(
    nextDaysLine("2026-12-29").split(", ").slice(1).join(", "),
    "Thu 2026-12-31, Fri 2027-01-01, Sat 2027-01-02, Sun 2027-01-03, Mon 2027-01-04, Tue 2027-01-05",
  );
  assert.equal(nextDaysLine("x"), "");
});
