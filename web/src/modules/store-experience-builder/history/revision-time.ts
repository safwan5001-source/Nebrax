import { formatDateTime } from "@/lib/formatting";

/**
 * CUST-H5-4 — عرض وقت لقطة محفوظة بلغة التاجر: الوقت النسبي («قبل 3 ساعات») مع الوقت المطلق. لغة لا أرقام مراجعات (§4.4).
 * دوال نقيّة (الوقت الحالي يُمرَّر) فتُختبر بلا ساعة.
 */

const UNITS: ReadonlyArray<readonly [Intl.RelativeTimeFormatUnit, number]> = [
  ["year", 365 * 24 * 3600],
  ["month", 30 * 24 * 3600],
  ["week", 7 * 24 * 3600],
  ["day", 24 * 3600],
  ["hour", 3600],
  ["minute", 60],
];

/** وقت نسبي (`auto`: «الآن» بدل «قبل 0 ثانية»). تواريخ غير صالحة أو مستقبلية بفارق صغير ⇒ «الآن». */
export function relativeTimeLabel(iso: string | null, locale: "ar" | "en", nowMs: number): string {
  const formatter = new Intl.RelativeTimeFormat(locale === "ar" ? "ar" : "en", { numeric: "auto" });
  const then = iso ? Date.parse(iso) : Number.NaN;
  if (!Number.isFinite(then)) return formatter.format(0, "second");
  const seconds = Math.round((then - nowMs) / 1000);
  const abs = Math.abs(seconds);
  for (const [unit, size] of UNITS) {
    if (abs >= size) return formatter.format(Math.trunc(seconds / size), unit);
  }
  return formatter.format(0, "second");
}

/** وقت مطلق قصير (تاريخ + ساعة) بلغة الواجهة عبر المنسِّق المركزي (ميلادي بأرقام لاتينية)؛ غير صالح ⇒ شرطة. */
export function absoluteTimeLabel(iso: string | null, locale: "ar" | "en"): string {
  return formatDateTime(iso, locale);
}
