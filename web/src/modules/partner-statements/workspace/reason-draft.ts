/**
 * مسودة **نص سبب القرار فقط** محلياً عند انقطاع الجلسة/الشبكة (IMP-PS-A4b). لا تُحفَظ مبالغ ولا بيانات كشف ولا معرّفات وحدات ولا أسماء أطراف: المفتاح (مقارنة + سطر + إجراء) والسبب والوقت فقط.
 * `sessionStorage` (تنتهي بإغلاق التبويب) بصلاحية قصيرة (ساعتان) وسقف عدد؛ كل نداء مُحاط بـtry/catch فلا تكسر الشاشة عند حجب التخزين.
 */
const PREFIX = 'ps-reason-draft:';
const TTL_MS = 2 * 60 * 60 * 1000;
const MAX_ENTRIES = 30;
const MAX_LENGTH = 500;

interface Stored {
  reason: string;
  at: number;
}

const storage = (): Storage | null => {
  try {
    return typeof window === 'undefined' ? null : window.sessionStorage;
  } catch {
    return null;
  }
};

export const draftKey = (reconciliationId: string, lineId: string, action: string): string => `${PREFIX}${reconciliationId}:${lineId}:${action}`;

export function saveReasonDraft(key: string, reason: string, now = Date.now()): void {
  const store = storage();
  if (!store) return;
  try {
    if (reason.trim() === '') {
      store.removeItem(key);
      return;
    }
    store.setItem(key, JSON.stringify({ reason: reason.slice(0, MAX_LENGTH), at: now } satisfies Stored));
    prune(store, now);
  } catch {
    /* حجب التخزين لا يكسر الشاشة */
  }
}

export function loadReasonDraft(key: string, now = Date.now()): string {
  const store = storage();
  if (!store) return '';
  try {
    const raw = store.getItem(key);
    if (!raw) return '';
    const parsed = JSON.parse(raw) as Partial<Stored>;
    if (typeof parsed.reason !== 'string' || typeof parsed.at !== 'number' || now - parsed.at > TTL_MS) {
      store.removeItem(key);
      return '';
    }
    return parsed.reason.slice(0, MAX_LENGTH);
  } catch {
    return '';
  }
}

export function clearReasonDraft(key: string): void {
  try {
    storage()?.removeItem(key);
  } catch {
    /* تجاهل */
  }
}

function prune(store: Storage, now: number): void {
  const entries: { key: string; at: number }[] = [];
  for (let i = 0; i < store.length; i += 1) {
    const key = store.key(i);
    if (!key || !key.startsWith(PREFIX)) continue;
    try {
      const parsed = JSON.parse(store.getItem(key) ?? '') as Partial<Stored>;
      entries.push({ key, at: typeof parsed.at === 'number' ? parsed.at : 0 });
    } catch {
      entries.push({ key, at: 0 });
    }
  }
  entries.sort((a, b) => b.at - a.at);
  for (const [index, entry] of entries.entries()) {
    if (index >= MAX_ENTRIES || now - entry.at > TTL_MS) store.removeItem(entry.key);
  }
}
