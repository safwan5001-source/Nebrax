import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createLeaseLocks, type LeaseStorage } from './lease-locks';

function memory(): LeaseStorage {
  const m = new Map<string, string>();

  return { getItem: (k) => m.get(k) ?? null, setItem: (k, v) => void m.set(k, v), removeItem: (k) => void m.delete(k) };
}

describe('lease locks (سقوط بلا Web Locks)', () => {
  beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(0); });
  afterEach(() => { vi.useRealTimers(); });

  it('إيجار حصري: الثاني ينتظر حتى يحرّر الأول', async () => {
    const storage = memory();
    const now = () => Date.now();
    const a = createLeaseLocks(storage, 'a', now);
    const b = createLeaseLocks(storage, 'b', now);
    const order: string[] = [];
    let releaseA: () => void = () => {};

    void a.request('n', { mode: 'exclusive' }, () => new Promise<void>((r) => { order.push('a'); releaseA = r; }));
    await vi.advanceTimersByTimeAsync(0);
    void b.request('n', { mode: 'exclusive' }, () => new Promise<void>((r) => { order.push('b'); r(); }));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(order).toEqual(['a']);

    releaseA();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(order).toEqual(['a', 'b']);
  });

  it('إيجار ميت (تبويب أُغلق بلا تجديد) يتولاه المنتظر بعد المهلة', async () => {
    const storage = memory();
    storage.setItem('awj:lease:n', JSON.stringify({ owner: 'ghost', ts: 0 }));
    const b = createLeaseLocks(storage, 'b', () => Date.now());
    const got = vi.fn();
    void b.request('n', { mode: 'exclusive' }, () => new Promise<void>((r) => { got(); r(); }));
    await vi.advanceTimersByTimeAsync(1_000);
    expect(got).not.toHaveBeenCalled(); // الإيجار ما زال حيّاً (ts=0, الآن=1000 < 6000)
    await vi.advanceTimersByTimeAsync(8_000);
    expect(got).toHaveBeenCalledTimes(1);
  });

  it('الحامل يجدّد فلا يسرقه المنتظر، والإلغاء بالإشارة يرفض الطلب المنتظِر', async () => {
    const storage = memory();
    const now = () => Date.now();
    const a = createLeaseLocks(storage, 'a', now);
    const b = createLeaseLocks(storage, 'b', now);
    void a.request('n', { mode: 'exclusive' }, () => new Promise<void>(() => {}));
    await vi.advanceTimersByTimeAsync(0);

    const ctl = new AbortController();
    const waiting = b.request('n', { mode: 'exclusive', signal: ctl.signal }, async () => {});
    const rejected = waiting.then(() => 'ok', (e: Error) => e.name);
    await vi.advanceTimersByTimeAsync(30_000); // أكثر من TTL: a يجدّد كل 2ث
    ctl.abort();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await rejected).toBe('AbortError');
  });

  it('حامل تأخّر تجديده فتولّاه غيره: لا يكتب فوق إيجار الخلف ويُعلن الضياع فيتنازل (Codex)', async () => {
    const storage = memory();
    let t = 0;
    const now = () => t;
    const a = createLeaseLocks(storage, 'a', now);
    const lost = vi.fn();
    void a.request('n', { mode: 'exclusive' }, (lock) => new Promise<void>((resolve) => {
      lock?.lost?.addEventListener('abort', () => { lost(); resolve(); });
    }));
    await vi.advanceTimersByTimeAsync(0);
    expect(JSON.parse(storage.getItem('awj:lease:n') as string).owner).toBe('a');

    // تبويب a مُجمَّد: انتهت مهلته وتولّى b الإيجار.
    storage.setItem('awj:lease:n', JSON.stringify({ owner: 'b', ts: 10_000 }));
    t = 11_000;
    await vi.advanceTimersByTimeAsync(2_500); // يستأنف مؤقّت التجديد في a

    expect(lost).toHaveBeenCalledTimes(1);
    expect(JSON.parse(storage.getItem('awj:lease:n') as string).owner).toBe('b'); // لم يُسرق
  });

  it('فشل كتابة الإيجار عند الاستحواذ لا يترك الطلب معلّقاً: يعيد المحاولة بعد تعافي التخزين (Codex)', async () => {
    const m = new Map<string, string>();
    let failWrites = true;
    const storage: LeaseStorage = {
      getItem: (k) => m.get(k) ?? null,
      setItem: (k, v) => { if (failWrites) throw new Error('QuotaExceededError'); m.set(k, v); },
      removeItem: (k) => void m.delete(k),
    };
    const a = createLeaseLocks(storage, 'a', () => Date.now());
    const got = vi.fn();
    void a.request('n', { mode: 'exclusive' }, () => new Promise<void>((r) => { got(); r(); }));
    await vi.advanceTimersByTimeAsync(5_000);
    expect(got).not.toHaveBeenCalled(); // التخزين معطوب: لا قيادة، ولا استثناء غير ملتقط

    failWrites = false;
    await vi.advanceTimersByTimeAsync(5_000);
    expect(got).toHaveBeenCalledTimes(1); // استأنف بعد التعافي
  });
});
