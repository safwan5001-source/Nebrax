import { riyalToMinor } from '@/lib/money';

/**
 * COPS-H4-2 — تحقق نموذج منطقة الشحن (دالة نقية). الرسم يُدخل **بالريال** ويُرسَل **بالهللات** (عدد صحيح) — لا float.
 * الحدود تطابق `StoreCommerceShippingZoneRequest`: الاسم/القيمة ≤ 255، الرسم صحيح 0..100000000000 هللة.
 */
export const ZONE_MATCH_TYPES = ['city', 'region'] as const;
export type ZoneMatchType = (typeof ZONE_MATCH_TYPES)[number];

export const MAX_TEXT = 255;
export const MAX_RATE_MINOR = 100_000_000_000;

export type ZoneFormValues = {
  name: string;
  matchType: ZoneMatchType;
  matchValue: string;
  /** الرسم بالريال كما كتبه المستخدم (نصّ). */
  rate: string;
  isActive: boolean;
};

export type ZoneFormErrorKey = 'nameRequired' | 'nameTooLong' | 'matchValueRequired' | 'matchValueTooLong' | 'rateInvalid' | 'rateTooLarge';
export type ZoneFormErrors = Partial<Record<'name' | 'matchValue' | 'rate', ZoneFormErrorKey>>;

/** الحمولة المُرسلة للخادم: المفاتيح المسموحة فقط (لا `tenant_id` ولا غيره). */
export type ZonePayload = {
  name: string;
  match_type: ZoneMatchType;
  match_value: string;
  rate_amount_minor: number;
  is_active: boolean;
};

export const EMPTY_ZONE_FORM: ZoneFormValues = { name: '', matchType: 'city', matchValue: '', rate: '0', isActive: true };

export function validateZoneForm(values: ZoneFormValues): { ok: true; payload: ZonePayload } | { ok: false; errors: ZoneFormErrors } {
  const errors: ZoneFormErrors = {};
  const name = values.name.trim();
  const matchValue = values.matchValue.trim();

  if (name === '') errors.name = 'nameRequired';
  else if ([...name].length > MAX_TEXT) errors.name = 'nameTooLong';

  if (matchValue === '') errors.matchValue = 'matchValueRequired';
  else if ([...matchValue].length > MAX_TEXT) errors.matchValue = 'matchValueTooLong';

  // الحقل فارغاً ليس «صفراً صامتاً»: الشحن المجاني قرار صريح بكتابة 0.
  const rateText = values.rate.trim();
  const rateMinor = rateText === '' ? NaN : riyalToMinor(rateText);
  if (!Number.isInteger(rateMinor) || rateMinor < 0) errors.rate = 'rateInvalid';
  else if (rateMinor > MAX_RATE_MINOR) errors.rate = 'rateTooLarge';

  if (Object.keys(errors).length > 0) return { ok: false, errors };

  return {
    ok: true,
    payload: { name, match_type: values.matchType, match_value: matchValue, rate_amount_minor: rateMinor, is_active: values.isActive },
  };
}
