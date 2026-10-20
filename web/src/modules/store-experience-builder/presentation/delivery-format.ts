/** The storefront's locale-aware delivery labels, kept presentation-only. */
const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const CLOCK = /^([01]\d|2[0-3]):[0-5]\d$/;

function addDays(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days)).toISOString().slice(0, 10);
}

function dateInTimezone(now: Date, timezone: string): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
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
  return new Intl.DateTimeFormat(input.locale, {
    weekday: "long",
    day: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(new Date(`${input.date}T12:00:00Z`));
}

export function formatDeliveryWindow(start: string, end: string, locale: string): string | null {
  if (!CLOCK.test(start) || !CLOCK.test(end)) return null;
  const format = (clock: string) => new Intl.DateTimeFormat(locale, {
    hour: "numeric",
    minute: "2-digit",
    timeZone: "UTC",
  }).format(new Date(`1970-01-01T${clock}:00Z`));
  return `${format(start)} – ${format(end)}`;
}
