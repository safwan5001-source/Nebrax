import {
  getCountries,
  getCountryCallingCode,
  getExampleNumber,
  parsePhoneNumberFromString,
  type CountryCode,
  type PhoneNumber,
} from 'libphonenumber-js/core';
import metadata from 'libphonenumber-js/metadata.max.json';
import examples from 'libphonenumber-js/examples.mobile.json';
import { digitsOnly, normalizePhoneText } from './digits';

/**
 * منطق الهاتف الدولي (E.164) فوق libphonenumber-js — مصدر واحد للتحقق والتحويل.
 * يستعمل بيانات `max` الكاملة (أنماط حقيقية لكل دولة) لا فحص الطول وحده.
 */

export type { CountryCode };

export const DEFAULT_COUNTRY: CountryCode = 'SA';
/** أقصى طول للرقم الدولي (رمز الدولة + الرقم الوطني) بحسب E.164. */
export const E164_MAX_DIGITS = 15;

const meta = metadata as unknown as Parameters<typeof getCountries>[0];
const callingCodeTable = (metadata as unknown as { country_calling_codes: Record<string, CountryCode[]> }).country_calling_codes;

export function allCountries(): CountryCode[] {
  return getCountries(meta);
}

export function callingCodeOf(country: CountryCode): string {
  return getCountryCallingCode(country, meta);
}

/** الدولة «الرئيسية» لرمز اتصال مشترك (+1 → US، +7 → RU، +44 → GB …) أو null لرمز غير معروف. */
export function mainCountryFor(callingCode: string): CountryCode | null {
  return callingCodeTable[callingCode]?.[0] ?? null;
}

/** أطول رمز اتصال معروف يبدأ به النص (1–3 خانات)، أو null. */
export function matchCallingCode(digits: string): string | null {
  for (let len = Math.min(3, digits.length); len >= 1; len--) {
    const candidate = digits.slice(0, len);
    if (callingCodeTable[candidate]) return candidate;
  }
  return null;
}

function parse(text: string, country?: CountryCode): PhoneNumber | undefined {
  try {
    return parsePhoneNumberFromString(text, country as CountryCode, meta);
  } catch {
    return undefined;
  }
}

/** أنواع لا تصلح رقم جوال لتسجيل حساب. VOIP وFIXED_LINE_OR_MOBILE مقبولان (بيانات بعض الدول لا تفرّق). */
const NON_MOBILE_TYPES = new Set(['FIXED_LINE', 'TOLL_FREE', 'PREMIUM_RATE', 'SHARED_COST', 'PERSONAL_NUMBER', 'PAGER', 'UAN', 'VOICEMAIL']);

/**
 * هل القيمة رقم E.164 صالح؟ — النمط والطول حسب دولة الرقم نفسه.
 * `mobileOnly` (الافتراضي) يرفض الأنواع الثابتة/المجانية/المدفوعة ويقبل المتحرك وما لا يمكن تمييزه.
 */
export function isValidE164(value: string, options: { mobileOnly?: boolean } = {}): boolean {
  if (!/^\+[1-9]\d{6,14}$/.test(value)) return false;
  const parsed = parse(value);
  if (!parsed?.isValid()) return false;
  if (options.mobileOnly === false) return true;
  const type = parsed.getType();
  return type === undefined || !NON_MOBILE_TYPES.has(type);
}

/**
 * يبني قيمة E.164 من رقم وطني مكتوب لدولة معيّنة. يزيل البادئة الوطنية (0) عند الحاجة
 * ولا يكرّر رمز الدولة. عند عدم اكتمال الرقم يعيد `+{رمز}{الأرقام}` (غير صالح بعد، لكنه قابل للتحقق لاحقاً).
 * فارغ ⇒ ''.
 */
export function toE164(nationalInput: string, country: CountryCode): string {
  const digits = digitsOnly(nationalInput);
  if (!digits) return '';
  const parsed = parse(digits, country);
  if (parsed && parsed.number) return parsed.number;
  return `+${callingCodeOf(country)}${digits}`;
}

/**
 * يفكّ E.164 (أو نصاً دولياً جزئياً يبدأ بـ +) إلى دولة ورقم وطني.
 * `preferred` تُفضَّل حين تشارك رمز الاتصال نفسه (US/CA…).
 */
export function splitInternational(
  text: string,
  preferred?: CountryCode,
): { country: CountryCode; national: string } | null {
  const normalized = normalizePhoneText(text);
  if (!normalized.startsWith('+')) return null;
  const digits = normalized.slice(1);
  if (!digits) return null;
  const parsed = parse(`+${digits}`);
  const code = parsed?.countryCallingCode ?? matchCallingCode(digits);
  if (!code) return null;
  const sharedWithPreferred = preferred && callingCodeOf(preferred) === code;
  const country = parsed?.country ?? (sharedWithPreferred ? preferred! : mainCountryFor(code));
  if (!country) return null;
  return { country, national: digits.slice(code.length).slice(0, E164_MAX_DIGITS - code.length) };
}

/**
 * يُظهر الرقم الوطني كما سيُحفظ: إن كتب المستخدم رمز الدولة بلا + ثم اكتمل رقم صالح، يُزال الرمز المكرّر من الحقل.
 */
export function displayNational(digits: string, country: CountryCode): string {
  const cc = callingCodeOf(country);
  if (digits.length > cc.length && digits.startsWith(cc)) {
    const parsed = parse(digits, country);
    if (parsed?.isValid() && parsed.nationalNumber === digits.slice(cc.length)) return parsed.nationalNumber;
  }
  return digits;
}

/** يفكّ قيمة E.164 مخزَّنة إلى حالة المكوّن. قيمة غير معروفة ⇒ null. */
export function fromE164(value: string): { country: CountryCode; national: string } | null {
  if (!value) return null;
  const parsed = parse(value.startsWith('+') ? value : `+${digitsOnly(value)}`);
  if (!parsed) return splitInternational(value.startsWith('+') ? value : `+${value}`);
  const country = parsed.country ?? mainCountryFor(parsed.countryCallingCode);
  return country ? { country, national: parsed.nationalNumber } : null;
}

/** مثال رقم جوال محلي للدولة (أرقام إنجليزية) لاستعماله placeholder، أو ''. */
export function exampleNational(country: CountryCode): string {
  try {
    const example = getExampleNumber(country, examples, meta);
    return example ? example.formatNational() : '';
  } catch {
    return '';
  }
}
