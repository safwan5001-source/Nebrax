import { millilitersToLiters } from '@/lib/fuel-quantity';
import { displayLocale, formatDate, formatTime } from '@/lib/formatting';
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
