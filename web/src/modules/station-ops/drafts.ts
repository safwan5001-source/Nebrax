/**
 * UI-2 — مسودة محلية لقراءات لم تُحفظ بعد (حماية من إغلاق التبويب/إعادة التحميل أثناء الكتابة).
 *
 * **ليست حفظاً على الخادم** وتُعرض للمستخدم هكذا. تُخزَّن نصوص القراءات الخام فقط (أرقام تشغيلية، لا رموز ولا بيانات شخصية) في
 * `sessionStorage` (تموت بإغلاق التبويب) بمفتاح يضم النطاق (مستأجر|مستخدم|محطة) والوردية والمرحلة، وتنتهي بعد `DRAFT_TTL_MS`.
 * تُمسح فور تأكيد الخادم لكل قراءة، وعند تغيّر النطاق لا تُقرأ أصلاً (المفتاح يتغيّر).
 */

export const DRAFT_TTL_MS = 8 * 60 * 60_000;
const PREFIX = 'awj:fuel-ops:draft:';

export type DraftValues = Record<string, string>;

function storageOrNull(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

export function draftKey(scope: string, shiftId: string, stage: string): string {
  return `${PREFIX}${scope}:${shiftId}:${stage}`;
}

export function loadDraft(key: string, now: number = Date.now()): DraftValues {
  try {
    const raw = storageOrNull()?.getItem(key);
    if (!raw) return {};
    const parsed = JSON.parse(raw) as { at?: unknown; values?: unknown };
    if (typeof parsed.at !== 'number' || now - parsed.at > DRAFT_TTL_MS || typeof parsed.values !== 'object' || parsed.values === null) return {};
    const values: DraftValues = {};
    for (const [id, value] of Object.entries(parsed.values as Record<string, unknown>)) if (typeof value === 'string' && value.length <= 32) values[id] = value;
    return values;
  } catch {
    return {};
  }
}

export function saveDraft(key: string, values: DraftValues, now: number = Date.now()): void {
  const filled = Object.fromEntries(Object.entries(values).filter(([, value]) => value.trim() !== ''));
  try {
    const storage = storageOrNull();
    if (!storage) return;
    if (Object.keys(filled).length === 0) storage.removeItem(key);
    else storage.setItem(key, JSON.stringify({ at: now, values: filled }));
  } catch {
    // محجوب/ممتلئ: المسودة تبقى في ذاكرة الصفحة فقط.
  }
}

export function clearDraft(key: string): void {
  try {
    storageOrNull()?.removeItem(key);
  } catch {
    // لا شيء
  }
}
