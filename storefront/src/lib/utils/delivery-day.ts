/**
 * FLOWERS-H9b — display helpers for the "delivery promise" band. Pure and
 * locale-aware; the *facts* (date, window, timezone) come from the public
 * delivery schedule — nothing here decides what is deliverable.
 */

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

/** `Y-m-d` of `now` on the wall clock of `timezone`. */
export function dateInTimezone(now: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

function addDays(date: string, days: number): string {
  const [y, m, d] = date.split("-").map(Number);
  const next = new Date(Date.UTC(y, m - 1, d + days));
  return next.toISOString().slice(0, 10);
}

/** A calendar date (`Y-m-d`) as "Tuesday, 6 October" — no timezone, no today/tomorrow. */
export function formatPlainDate(date: string, locale: string): string | null {
  if (!ISO_DATE.test(date)) return null;
  return new Intl.DateTimeFormat(locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(`${date}T12:00:00Z`));
}

export function formatDeliveryDay(input: {
  date: string;
  timezone: string;
  locale: string;
  todayLabel: string;
  tomorrowLabel: string;
  now?: Date;
}): string | null {
  if (!ISO_DATE.test(input.date)) return null;
  const today = dateInTimezone(input.now ?? new Date(), input.timezone);
  if (input.date === today) return input.todayLabel;
  if (input.date === addDays(today, 1)) return input.tomorrowLabel;
  return formatPlainDate(input.date, input.locale);
}

/** `19:00`–`22:00` as a locale-formatted range, or null for a malformed pair. */
export function formatDeliveryWindow(
  start: string,
  end: string,
  locale: string,
): string | null {
  if (!CLOCK.test(start) || !CLOCK.test(end)) return null;
  const format = (clock: string) =>
    new Intl.DateTimeFormat(locale, {
      hour: "numeric",
      minute: "2-digit",
      timeZone: "UTC",
    }).format(new Date(`1970-01-01T${clock}:00Z`));
  return `${format(start)} – ${format(end)}`;
}
