import type { CurrencyCode } from '../types';

/** إعداد عملة واحدة — كل ما يلزم لتنسيق رقمي صحيح. */
export interface CurrencyConfig {
  code: CurrencyCode;
  /** رمز العرض (يفضَّل الرمز المحلّي للعملات العربية). */
  symbol: string;
  /** موضع الرمز بالنسبة للرقم. */
  position: 'prefix' | 'suffix';
  /** عدد المنازل العشرية (SAR=2، KWD=3، JPY=0). */
  precision: number;
  /** locale لتجميع الآلاف/الفواصل (أرقام غربية موحّدة). */
  locale: string;
}

/**
 * سجلّ العملات المدعومة. الأرقام تُعرض غربية (locale=en-US) اتساقاً مع طبقة `.num`،
 * والرمز يُلحق/يُسبق حسب العرف. الدقة حسب المعيار (الخليجية ثلاثية = KWD/BHD/OMR).
 */
export const CURRENCIES: Record<CurrencyCode, CurrencyConfig> = {
  SAR: { code: 'SAR', symbol: '﷼', position: 'suffix', precision: 2, locale: 'en-US' },
  AED: { code: 'AED', symbol: 'د.إ', position: 'suffix', precision: 2, locale: 'en-US' },
  QAR: { code: 'QAR', symbol: 'ر.ق', position: 'suffix', precision: 2, locale: 'en-US' },
  OMR: { code: 'OMR', symbol: 'ر.ع', position: 'suffix', precision: 3, locale: 'en-US' },
  KWD: { code: 'KWD', symbol: 'د.ك', position: 'suffix', precision: 3, locale: 'en-US' },
  BHD: { code: 'BHD', symbol: 'د.ب', position: 'suffix', precision: 3, locale: 'en-US' },
  EGP: { code: 'EGP', symbol: 'ج.م', position: 'suffix', precision: 2, locale: 'en-US' },
  USD: { code: 'USD', symbol: '$', position: 'prefix', precision: 2, locale: 'en-US' },
  EUR: { code: 'EUR', symbol: '€', position: 'prefix', precision: 2, locale: 'en-US' },
  GBP: { code: 'GBP', symbol: '£', position: 'prefix', precision: 2, locale: 'en-US' },
  JPY: { code: 'JPY', symbol: '¥', position: 'prefix', precision: 0, locale: 'en-US' },
};

export const DEFAULT_CURRENCY: CurrencyCode = 'SAR';

export function getCurrency(code: CurrencyCode | string | null | undefined): CurrencyConfig {
  return CURRENCIES[(code as CurrencyCode)] ?? CURRENCIES[DEFAULT_CURRENCY];
}
