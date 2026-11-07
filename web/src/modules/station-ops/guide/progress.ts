import type { TourId } from './tours';

/**
 * حفظ تقدّم الجولات لكل (مؤسسة، مستخدم) على هذا المتصفح. لا يلمس الخادم ولا يحمل بيانات تشغيلية: حالة الجولة ورقم الخطوة فقط.
 * التخزين قد يغيب (وضع خاص/حظر) فكل قراءة/كتابة محروسة، وتعمل الجولات بلا حفظ.
 */
export type TourStatus = 'in_progress' | 'completed' | 'skipped';

export interface TourRecord {
  version: number;
  status: TourStatus;
  step: number;
  at: string;
}

export type ProgressMap = Partial<Record<TourId, TourRecord>>;

const PREFIX = 'awj.station-guide.v1';

export function progressKey(tenantId: string, userId: string): string {
  return `${PREFIX}.${tenantId}.${userId}`;
}

function isRecord(value: unknown): value is TourRecord {
  if (typeof value !== 'object' || value === null) return false;
  const record = value as Record<string, unknown>;
  return typeof record.version === 'number'
    && (record.status === 'in_progress' || record.status === 'completed' || record.status === 'skipped')
    && typeof record.step === 'number' && Number.isInteger(record.step) && record.step >= 0
    && typeof record.at === 'string';
}

export function readProgress(key: string, storage: Pick<Storage, 'getItem'> | null = safeStorage()): ProgressMap {
  if (!storage) return {};
  try {
    const raw = storage.getItem(key);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return {};
    const map: ProgressMap = {};
    for (const [id, value] of Object.entries(parsed as Record<string, unknown>)) if (isRecord(value)) map[id as TourId] = value;
    return map;
  } catch {
    return {};
  }
}

export function writeProgress(key: string, map: ProgressMap, storage: Pick<Storage, 'setItem'> | null = safeStorage()): void {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(map));
  } catch {
    /* تخزين ممتلئ/محظور: تستمر الجولة بلا حفظ */
  }
}

function safeStorage(): Storage | null {
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** سجل بنسخة أقدم من نسخة الجولة الحالية = كأنه لم يبدأ (يُعاد عرضها). */
export function currentRecord(map: ProgressMap, id: TourId, version: number): TourRecord | undefined {
  const record = map[id];
  return record && record.version >= version ? record : undefined;
}

export function withRecord(map: ProgressMap, id: TourId, record: TourRecord): ProgressMap {
  return { ...map, [id]: record };
}

/**
 * التشغيل التلقائي للجولة الترحيبية: لمن لا سجل له فقط. يُعطَّل في الاختبارات الآلية (NODE_ENV=test أو WebDriver) كي لا تُغطّي
 * الشاشات تحت الاختبار، ما لم يُفرَض صراحةً بمفتاح `awj.station-guide.force`.
 */
export function autoStartAllowed(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    if (window.localStorage.getItem('awj.station-guide.force') === '1') return true;
  } catch { /* تجاهل */ }
  if (process.env.NODE_ENV === 'test') return false;
  return navigator.webdriver !== true;
}
