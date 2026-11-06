import { EMPTY_FORM, type FormValues } from './logic';

/**
 * FUEL-B5 — مسودة النموذج المحلية (حماية من إغلاق التبويب/إعادة التحميل أثناء الكتابة). **ليست حفظاً على الخادم** وتُعرض للمستخدم هكذا.
 * نصوص الحقول فقط (أرقام تشغيلية ومعرّفات؛ لا رموز ولا بيانات شخصية) في `sessionStorage` بمفتاح يضم النطاق (مستأجر|مستخدم|فرع) والمحطة،
 * وتنتهي بعد `FORM_TTL_MS`. تُمسح فور تأكيد الخادم لإنشاء المسودة.
 */

export const FORM_TTL_MS = 8 * 60 * 60_000;
const PREFIX = 'awj:fuel-ops:rcv-form:';

const KEYS = Object.keys(EMPTY_FORM) as Array<keyof FormValues>;

function storage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function formKey(scope: string, stationId: string): string {
  return `${PREFIX}${scope}:${stationId}`;
}

export function loadForm(key: string, now: number = Date.now()): FormValues | null {
  try {
    const raw = storage()?.getItem(key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { at?: unknown; values?: unknown };
    if (typeof parsed.at !== 'number' || now - parsed.at > FORM_TTL_MS || typeof parsed.values !== 'object' || parsed.values === null) return null;
    const values = parsed.values as Record<string, unknown>;
    const form: FormValues = { ...EMPTY_FORM };
    for (const field of KEYS) {
      const value = values[field];
      if (typeof value === 'string' && value.length <= 1000) (form as unknown as Record<string, string>)[field] = value;
    }
    if (form.readingType !== 'physical' && form.readingType !== 'atg') form.readingType = 'physical';
    return form;
  } catch {
    return null;
  }
}

export function saveForm(key: string, form: FormValues, now: number = Date.now()): void {
  try {
    const store = storage();
    if (!store) return;
    const empty = KEYS.every((field) => field === 'readingType' || form[field] === '');
    if (empty) store.removeItem(key);
    else store.setItem(key, JSON.stringify({ at: now, values: form }));
  } catch {
    // محجوب/ممتلئ: المسودة تبقى في ذاكرة الصفحة فقط.
  }
}

export function clearForm(key: string): void {
  try {
    storage()?.removeItem(key);
  } catch {
    // لا شيء
  }
}
