import type { LockManagerLike } from './tab-coordinator';

/**
 * سقوط لمتصفح بلا Web Locks (COPS-H3-3): عقد إيجار في `localStorage` يطابق واجهة `LockManagerLike` (حصري، طابور، تحرير بإنهاء الوعد).
 * الحامل يجدّد كل `RENEW_MS`؛ إيجار أقدم من `TTL_MS` يُعدّ ميتاً (تبويب أُغلق) فيتولاه المنتظر. أضعف من Web Locks (سباق نافذة التجديد) فيُعلن في الواجهة.
 */
export interface LeaseStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const RENEW_MS = 2_000;
const TTL_MS = 6_000;

export function createLeaseLocks(storage: LeaseStorage, ownerId: string, now: () => number = () => Date.now()): LockManagerLike {
  const read = (key: string): { owner: string; ts: number } | null => {
    try {
      const raw = storage.getItem(key);
      return raw ? (JSON.parse(raw) as { owner: string; ts: number }) : null;
    } catch {
      return null;
    }
  };

  return {
    async request(name, options, callback) {
      const key = `awj:lease:${name}`;
      await new Promise<void>((resolve, reject) => {
        const poll = (): void => {
          if (options.signal?.aborted) {
            clearInterval(waiter);
            reject(new DOMException('aborted', 'AbortError'));
            return;
          }
          const held = read(key);
          if (held === null || held.owner === ownerId || now() - held.ts > TTL_MS) {
            clearInterval(waiter);
            storage.setItem(key, JSON.stringify({ owner: ownerId, ts: now() }));
            // تحقق ثانٍ بعد الكتابة: إن سبقنا آخر في السباق نعود للانتظار.
            const confirmed = read(key);
            if (confirmed?.owner !== ownerId) {
              waiter = setInterval(poll, RENEW_MS);
              return;
            }
            const renew = setInterval(() => storage.setItem(key, JSON.stringify({ owner: ownerId, ts: now() })), RENEW_MS);
            callback()
              .catch(() => {})
              .finally(() => {
                clearInterval(renew);
                const current = read(key);
                if (current?.owner === ownerId) storage.removeItem(key);
                resolve();
              });
          }
        };
        let waiter: ReturnType<typeof setInterval> = setInterval(poll, RENEW_MS);
        poll();
      });
    },
  };
}
