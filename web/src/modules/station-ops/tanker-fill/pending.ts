import type { FillBody } from './logic';

/**
 * TANKER-PR7 — المحاولة **غير المحسومة** (مهلة/انقطاع/5xx بعد الإرسال): قد يكون السند سُجِّل فعلاً. تُحفظ مؤقتاً في `sessionStorage` (تموت بإغلاق التبويب)
 * بمفتاح (مستأجر|مستخدم|محطة) كي تبقى «تحقق من الحالة» متاحة بعد إعادة تحميل الصفحة، **ولا يُسمح بسند جديد قبل حسمها** (يمنع تكرار السند عند ضياع الرد).
 * تحفظ الحمولة والمفتاح فقط (معرّفات وكمية ورقم سند — لا رمز ولا بيانات شخصية)، وتُمسح عند الحسم (نجاح مؤكد/عدم وجود السند وقرار الموظف).
 */

export const PENDING_TTL_MS = 6 * 60 * 60_000;
const PREFIX = 'awj:fuel-ops:tanker-fill:pending:';

export interface PendingAttempt {
  /** الحمولة كاملة **بمفتاحها**: إعادة الإرسال الصريحة تستعمل المفتاح نفسه فيعيد الخادم السند الأول إن كان قد سُجِّل. */
  body: FillBody;
  at: number;
}

export interface PendingStore {
  load(): PendingAttempt | null;
  save(body: FillBody): void;
  clear(): void;
}

export function createPendingStore(scope: string, options: { storage?: Storage | null; now?: () => number } = {}): PendingStore {
  const now = options.now ?? Date.now;
  let storage: Storage | null;
  try {
    storage = options.storage === undefined ? (typeof window === 'undefined' ? null : window.sessionStorage) : options.storage;
  } catch {
    storage = null;
  }
  const slot = `${PREFIX}${scope}`;
  let memory: PendingAttempt | null = null;

  return {
    load() {
      let current = memory;
      if (!current) {
        try {
          const raw = storage?.getItem(slot);
          if (raw) current = JSON.parse(raw) as PendingAttempt;
        } catch {
          current = null;
        }
      }
      if (!current || typeof current.at !== 'number' || typeof current.body?.idempotency_key !== 'string' || typeof current.body?.fuel_station_id !== 'string') return null;
      if (now() - current.at > PENDING_TTL_MS) return null;
      return current;
    },
    save(body) {
      // المحاولة نفسها (المفتاح نفسه) تحتفظ بوقت بدئها الأصلي: إسناد السند إلى المحاولة يعتمد عليه (`findRecordedFill`)، فلا يتأخر بإعادة الحفظ بعد ردّ غير مؤكد.
      const existing = this.load();
      memory = { body, at: existing && existing.body.idempotency_key === body.idempotency_key ? existing.at : now() };
      try {
        storage?.setItem(slot, JSON.stringify(memory));
      } catch {
        // تخزين محجوب: تبقى في الذاكرة لهذه الصفحة.
      }
    },
    clear() {
      memory = null;
      try {
        storage?.removeItem(slot);
      } catch {
        // لا شيء
      }
    },
  };
}
