import type { CurrencyCode } from '../types';
import { displayLocale } from '@/lib/formatting';
import { getCurrency, type CurrencyConfig } from '../constants/currencies';

/**
 * تنسيق مبلغ بالوحدات الصغرى (هللات/سنتات) إلى نصّ عملة — بلا `float` في القيمة المخزّنة.
 * القسمة على 10^precision تتمّ عند العرض فقط، والتجميع عبر Intl.
 *
 * SAR: 100050 ⇒ "1,000.50 ﷼"  ·  USD: 100050 ⇒ "$ 1,000.50"  ·  JPY: 1500 ⇒ "¥ 1,500"
 */
export function formatMoney(minor: number, currency: CurrencyCode | CurrencyConfig): string {
  const cfg = typeof currency === 'string' ? getCurrency(currency) : currency;
  const n = Number(minor);
  if (!Number.isFinite(n)) return '—';

  const value = n / 10 ** cfg.precision;
  const body = new Intl.NumberFormat(displayLocale(cfg.locale), {
    minimumFractionDigits: cfg.precision,
    maximumFractionDigits: cfg.precision,
  }).format(value);

  return cfg.position === 'suffix' ? `${body} ${cfg.symbol}` : `${cfg.symbol} ${body}`;
}

/** مُنشئ منسّق مربوط بعملة — يمرَّر للقوالب كـ `formatMoney(minor)`. */
export function makeMoneyFormatter(currency: CurrencyCode): (minor: number) => string {
  const cfg = getCurrency(currency);
  return (minor: number) => formatMoney(minor, cfg);
}
