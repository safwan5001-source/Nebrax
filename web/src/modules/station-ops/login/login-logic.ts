import { ApiError } from '@/lib/api';

/**
 * STATION-PIN — منطق نقي لشاشة دخول تطبيق المحطات (بلا شبكة ولا تخزين).
 * الأرقام تُعرض وتُرسل 0–9 لاتينية دائماً مهما كانت لغة الواجهة أو لوحة المفاتيح؛ الـPIN لا يُحفظ في أي تخزين.
 */

export const PIN_LENGTH = 6;
export const EMPLOYEE_NO_MAX = 64;

const AR_DIGITS = '٠١٢٣٤٥٦٧٨٩';
const FA_DIGITS = '۰۱۲۳۴۵۶۷۸۹';

/** أرقام عربية/فارسية ← لاتينية. */
export function toLatinDigits(input: string): string {
  return input.replace(/[٠-٩۰-۹]/g, (ch) => {
    const ar = AR_DIGITS.indexOf(ch);
    return String(ar >= 0 ? ar : FA_DIGITS.indexOf(ch));
  });
}

/** يبقي الأرقام فقط (حتى {@link PIN_LENGTH}) — لصق «٤٨٢ ٩١٥» أو «482-915» يصير «482915». */
export function sanitizePin(input: string): string {
  return toLatinDigits(input).replace(/\D/g, '').slice(0, PIN_LENGTH);
}

/** رقم الموظف كما يظهر في المنظومة: أرقام لاتينية، بلا فراغات طرفية، بلا حروف تحكم. */
export function sanitizeEmployeeNo(input: string): string {
  // eslint-disable-next-line no-control-regex
  return toLatinDigits(input).replace(/[\u0000-\u001f\u007f‎‏‪-‮\s]+/g, ' ').trim().slice(0, EMPLOYEE_NO_MAX);
}

export type LoginFieldError = 'employee_required' | 'pin_required' | 'pin_length';

export interface LoginValidation {
  ok: boolean;
  employeeNo: string;
  pin: string;
  errors: { employeeNo?: LoginFieldError; pin?: LoginFieldError };
}

export function validateLogin(employeeNoRaw: string, pinRaw: string): LoginValidation {
  const employeeNo = sanitizeEmployeeNo(employeeNoRaw);
  const pin = sanitizePin(pinRaw);
  const errors: LoginValidation['errors'] = {};
  if (employeeNo === '') errors.employeeNo = 'employee_required';
  if (pin === '') errors.pin = 'pin_required';
  else if (pin.length !== PIN_LENGTH) errors.pin = 'pin_length';
  return { ok: Object.keys(errors).length === 0, employeeNo, pin, errors };
}

export type LoginFailure = 'invalid' | 'throttled' | 'tenant_required' | 'subscription' | 'offline' | 'server' | 'unknown_tenant';

/**
 * يصنّف فشل الدخول إلى مفتاح رسالة محلية. الخادم يعيد رسالة عامة واحدة لكل أسباب رفض البيانات
 * (رقم مجهول/PIN خاطئ/غير نشط) فلا تُميَّز هنا أيضاً؛ و429 = تحديد معدل لا قفل حساب.
 */
export function classifyLoginFailure(error: unknown): LoginFailure {
  if (error instanceof ApiError) {
    const reason = error.body && typeof error.body === 'object' ? (error.body as { reason?: unknown }).reason : undefined;
    if (error.status === 429) return 'throttled';
    if (error.status === 422 && reason === 'tenant_required') return 'tenant_required';
    if (error.status === 404) return 'unknown_tenant';
    if (error.status === 403 && reason === 'subscription_inactive') return 'subscription';
    if (error.status === 422 || error.status === 401 || error.status === 403) return 'invalid';
    return 'server';
  }
  return 'offline';
}
