/**
 * CUST-H1-5 — Authoritative-timezone helpers for scheduled Version publishing.
 *
 * Browser timezone is never authoritative (architecture: `docs/plans/store/
 * CUST-H1-ARCH-1-...md` §18). The merchant enters a date/time understood as
 * wall-clock time *in the tenant's authoritative timezone* (`tenants.timezone`,
 * exposed read-only via `/me` → `company.timezone` — see `CompanyProfile`),
 * exactly like Shopify's own "Store defaults" timezone model: the scheduler
 * does not ask the merchant to pick a timezone inline, it interprets the
 * entered date/time using the account's already-authoritative zone and only
 * *displays* that zone so the merchant is never guessing. These helpers
 * convert that wall-clock value to/from a canonical UTC instant regardless of
 * what timezone the visiting browser happens to run in.
 */

export const DEFAULT_TENANT_TIMEZONE = "Asia/Riyadh";

/**
 * Falls back to the tenant model's own DB-level default when the configured
 * value is missing or not a real IANA identifier — never throws, never
 * silently uses the browser's zone.
 */
export function safeTimeZone(timeZone: string | null | undefined): string {
  const candidate = (timeZone ?? "").trim();
  if (!candidate) return DEFAULT_TENANT_TIMEZONE;
  try {
    // Throws RangeError for an invalid IANA identifier.
    new Intl.DateTimeFormat("en-US", { timeZone: candidate });
    return candidate;
  } catch {
    return DEFAULT_TENANT_TIMEZONE;
  }
}

/**
 * Epoch ms of a UTC calendar value. `Date.UTC` remaps years 0–99 to 1900–1999, which would silently
 * store a different instant than the merchant typed; `setUTCFullYear` does not.
 */
function utcMillisOf(year: number, month: number, day: number, hour = 0, minute = 0, second = 0): number {
  const date = new Date(0);
  date.setUTCFullYear(year, month, day);
  date.setUTCHours(hour, minute, second, 0);
  return date.getTime();
}

function offsetMinutesAt(utcMillis: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(utcMillis));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const asIfUtc = utcMillisOf(get("year"), get("month") - 1, get("day"), get("hour"), get("minute"), get("second"));
  return (asIfUtc - utcMillis) / 60000;
}

/**
 * Converts a `YYYY-MM-DD` date + `HH:mm` time, understood as wall-clock time
 * in `timeZone`, to a canonical UTC ISO-8601 string (explicit `Z` offset —
 * satisfies the backend's `scheduled_for` contract). Returns `null` for a
 * malformed date/time instead of guessing. DST-aware: a repeated wall time
 * resolves to its first occurrence, a skipped one to just after the gap.
 */
export function zonedWallTimeToUtcIso(
  dateValue: string,
  timeValue: string,
  timeZone: string,
): string | null {
  const dateMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateValue.trim());
  const timeMatch = /^(\d{2}):(\d{2})$/.exec(timeValue.trim());
  if (!dateMatch || !timeMatch) return null;
  const [year, month, day] = dateMatch.slice(1).map(Number);
  const [hour, minute] = timeMatch.slice(1).map(Number);
  if (month < 1 || month > 12 || day < 1 || day > 31 || hour > 23 || minute > 59) return null;

  const zone = safeTimeZone(timeZone);
  const naiveUtc = utcMillisOf(year, month - 1, day, hour, minute);
  if (Number.isNaN(naiveUtc)) return null;
  // Resolve the zone's offset *at the resulting instant*, not at the wall time read as UTC (which is
  // an hour off inside a DST transition window). The offsets in force a day either side bracket any
  // single transition; a candidate is valid only if the zone really has that offset at the instant
  // it yields (round-trip). Two valid candidates = the clock repeats (fall back): take the earlier,
  // first occurrence. None = the wall time was skipped (spring forward): read it with the offset in
  // force before the gap, which lands just after it — the usual "compatible" resolution.
  const DAY = 86_400_000;
  const before = offsetMinutesAt(naiveUtc - DAY, zone);
  const after = offsetMinutesAt(naiveUtc + DAY, zone);
  const valid = [...new Set([before, after])]
    .map((offset) => naiveUtc - offset * 60000)
    .filter((utc) => offsetMinutesAt(utc, zone) === (naiveUtc - utc) / 60000)
    .sort((a, b) => a - b);
  const date = new Date(valid[0] ?? naiveUtc - before * 60000);
  // An offset can push year-1 / year-9999 wall time out of 0001–9999, the only years the server's
  // gate (and a four-digit ISO instant) accepts.
  if (Number.isNaN(date.getTime()) || date.getUTCFullYear() < 1 || date.getUTCFullYear() > 9999) return null;
  return date.toISOString();
}

/**
 * The inverse of `zonedWallTimeToUtcIso` — formats a UTC instant back into
 * `{ date, time }` wall-clock values in `timeZone`, for prefilling a
 * reschedule dialog's native date/time inputs. Returns `null` for an
 * unparsable instant.
 */
export function utcIsoToZonedWallTime(
  iso: string,
  timeZone: string,
): { date: string; time: string } | null {
  const instant = new Date(iso);
  if (Number.isNaN(instant.getTime())) return null;
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: safeTimeZone(timeZone),
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(instant);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "";
  // Intl does not zero-pad the year (`1`, not `0001`), which a date input cannot read back.
  return { date: `${get("year").padStart(4, "0")}-${get("month")}-${get("day")}`, time: `${get("hour")}:${get("minute")}` };
}

/** `{ date, time }` for "now, rounded up to the next 30-minute mark" in `timeZone` — the schedule dialog's default suggestion (same rounding Shopify's own future-publishing picker defaults to). */
export function suggestedInitialWallTime(timeZone: string): { date: string; time: string } {
  const stepMs = 30 * 60000;
  const roundedMillis = Math.ceil((Date.now() + 60000) / stepMs) * stepMs;
  return (
    utcIsoToZonedWallTime(new Date(roundedMillis).toISOString(), timeZone) ?? { date: "", time: "" }
  );
}

/** Human-readable timezone label. Only names a city when the zone is proven to be it — never guessed from locale/country. */
export function timeZoneDisplayLabel(timeZone: string, locale: "ar" | "en"): string {
  const zone = safeTimeZone(timeZone);
  if (zone === "Asia/Riyadh") {
    return locale === "ar" ? "بتوقيت الرياض" : "Riyadh time";
  }
  const offset = timeZoneOffsetLabel(zone);
  return locale === "ar" ? `بتوقيت ${zone} (${offset})` : `${zone} time (${offset})`;
}

const offsetFormatters = new Map<string, Intl.DateTimeFormat>();

/** «GMT+03:00» لمنطقة (الآن)؛ «UTC» إن لم تُفهم. المُنسِّق يُخزَّن لكل منطقة (إنشاؤه مكلف وقوائم المناطق طويلة). */
export function timeZoneOffsetLabel(timeZone: string): string {
  try {
    let formatter = offsetFormatters.get(timeZone);
    if (!formatter) {
      formatter = new Intl.DateTimeFormat("en-US", { timeZone, timeZoneName: "longOffset" });
      offsetFormatters.set(timeZone, formatter);
    }
    const part = formatter
      .formatToParts(new Date())
      .find((p) => p.type === "timeZoneName");
    return part?.value ?? "UTC";
  } catch {
    return "UTC";
  }
}
