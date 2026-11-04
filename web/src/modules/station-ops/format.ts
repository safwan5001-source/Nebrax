import { millilitersToLiters } from '@/lib/fuel-quantity';
import { displayLocale } from '@/lib/formatting';
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
