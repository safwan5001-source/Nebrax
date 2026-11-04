import { millilitersToLiters } from '@/lib/fuel-quantity';
import { displayLocale, formatDate, formatDateTime, formatTime } from '@/lib/formatting';
import { formatMinorRiyal } from '@/lib/money';

/** سعر اللتر من الهللات (الخادم يخزّنه `bigint` هللات). */
export function formatPricePerLiter(minor: number): string {
  return formatMinorRiyal(minor);
}

/** كمية باللتر من mL صحيح (حساب صحيح لا عائم) — الرقم وحده؛ الوحدة تُعرض خارج خط mono عبر <Quantity>. */
export function formatLitersNumberFromMl(milliliters: number, locale: string): string {
  const liters = Number(millilitersToLiters(milliliters));
  return Number.isFinite(liters) ? new Intl.NumberFormat(displayLocale(locale), { maximumFractionDigits: 3 }).format(liters) : '—';
}

export function formatLitersNumberFromText(value: string, locale: string): string {
  const liters = Number(value);
  return value.trim() === '' || !Number.isFinite(liters) ? '—' : new Intl.NumberFormat(displayLocale(locale), { maximumFractionDigits: 3 }).format(liters);
}

/** تاريخ أو وقت بمنطقة المحطة الزمنية عبر المنسّقات المركزية (غير صالحة/غائبة ⇒ منطقة الجهاز). أرقام 0–9 دائماً. */
export function formatInZone(value: string | null, locale: string, timeZone: string | null | undefined, kind: 'date' | 'time'): string {
  if (!value) return '—';
  const render = (zone?: string) => (kind === 'date' ? formatDate(value, locale, { timeZone: zone }) : formatTime(value, locale, { timeZone: zone }));
  try {
    return render(timeZone || undefined);
  } catch {
    return render();
  }
}

/** كمية بثلاث منازل ثابتة (دقة mL كما في عداد المضخة): 690.500 لا 690.5 — تُستعمل لقراءات العدادات واللترات المحسوبة منها. */
export function formatLitersFixedFromMl(milliliters: number, locale: string): string {
  if (!Number.isSafeInteger(milliliters)) return '—';
  return new Intl.NumberFormat(displayLocale(locale), { minimumFractionDigits: 3, maximumFractionDigits: 3 }).format(milliliters / 1000);
}

/** وقت/تاريخ صالح فقط (غير صالح ⇒ null)، لحسابات المدة والترتيب دون `NaN`. */
export function parseInstant(value: string | null | undefined): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

export interface ElapsedParts { hours: number; minutes: number }

/** مدة بين لحظتين (دقائق كاملة). سالبة/غير صالحة ⇒ null — لا مدة مخترعة. */
export function elapsedBetween(from: string | null | undefined, to: string | number | null | undefined): ElapsedParts | null {
  const start = parseInstant(from);
  const end = typeof to === 'number' ? to : parseInstant(to);
  if (start === null || end === null || end < start) return null;
  const total = Math.floor((end - start) / 60_000);
  return { hours: Math.floor(total / 60), minutes: total % 60 };
}

/** تاريخ + وقت بمنطقة المحطة (وردية قد تعبر منتصف الليل: الوقت وحده يلتبس). منطقة غير صالحة ⇒ منطقة الجهاز؛ لحظة غير صالحة ⇒ «—». */
export function formatStampInZone(value: string | null | undefined, locale: string, timeZone: string | null | undefined): string {
  if (!value || parseInstant(value) === null) return '—';
  try {
    return formatDateTime(value, locale, { timeZone: timeZone || undefined });
  } catch {
    return formatDateTime(value, locale);
  }
}
