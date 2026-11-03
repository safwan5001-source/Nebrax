// @vitest-environment jsdom
import { act, cleanup, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { summaryFixture } from '../orders/test-fixtures';

const api = vi.hoisted(() => ({ fetchBoard: vi.fn() }));
vi.mock('./reception-api', () => api);

import { REVISION_DEBOUNCE_MS, useReceptionBoard } from './use-reception-board';

const tick = async (ms = 0) => { await act(async () => { await vi.advanceTimersByTimeAsync(ms); }); };
const data = (id: string) => ({ orders: [summaryFixture({ id })], truncated: false });

describe('useReceptionBoard', () => {
  beforeEach(() => { vi.useFakeTimers(); api.fetchBoard.mockReset(); api.fetchBoard.mockResolvedValue(data('a')); });
  afterEach(() => { cleanup(); vi.useRealTimers(); });

  it('يحمّل مرة عند التركيب ولا يستطلع وحده أبداً (لا مؤقّت دوري)', async () => {
    const { result } = renderHook(() => useReceptionBoard({ storefrontId: 's1', enabled: true, revision: 0 }));
    await tick();
    expect(result.current.status).toBe('ready');
    expect(api.fetchBoard).toHaveBeenCalledTimes(1);
    await tick(10 * 60_000);
    expect(api.fetchBoard).toHaveBeenCalledTimes(1);
  });

  it('تغيّر revision يعيد الجلب مرة واحدة بعد مهلة الدمج، وتغيّرات متتالية تُدمج', async () => {
    const { rerender } = renderHook(({ rev }) => useReceptionBoard({ storefrontId: 's1', enabled: true, revision: rev }), { initialProps: { rev: 0 } });
    await tick();
    rerender({ rev: 1 });
    await tick(100);
    rerender({ rev: 2 });
    await tick(REVISION_DEBOUNCE_MS + 10);
    expect(api.fetchBoard).toHaveBeenCalledTimes(2);
  });

  it('لا طلبان متوازيان: refresh أثناء الطيران يُنفَّذ مرة واحدة بعده', async () => {
    let release: (v: unknown) => void = () => {};
    api.fetchBoard.mockReturnValueOnce(new Promise((r) => { release = r; }));
    const { result } = renderHook(() => useReceptionBoard({ storefrontId: 's1', enabled: true, revision: 0 }));
    await tick();
    act(() => { result.current.refresh(); result.current.refresh(); });
    expect(api.fetchBoard).toHaveBeenCalledTimes(1);
    await act(async () => { release(data('a')); await vi.advanceTimersByTimeAsync(0); });
    await tick();
    expect(api.fetchBoard).toHaveBeenCalledTimes(2);
  });

  it('فشل التحديث بعد نجاح يُبقي آخر لوحة جيدة ويعرض الخطأ؛ فشل أول تحميل ⇒ error', async () => {
    const { result } = renderHook(() => useReceptionBoard({ storefrontId: 's1', enabled: true, revision: 0 }));
    await tick();
    api.fetchBoard.mockRejectedValueOnce(new Error('x'));
    act(() => result.current.refresh());
    await tick();
    expect(result.current.status).toBe('ready');
    expect(result.current.errorKind).not.toBeNull();
    expect(result.current.orders).toHaveLength(1);

    cleanup();
    api.fetchBoard.mockReset();
    api.fetchBoard.mockRejectedValue(new Error('x'));
    const fresh = renderHook(() => useReceptionBoard({ storefrontId: 's1', enabled: true, revision: 0 }));
    await tick();
    expect(fresh.result.current.status).toBe('error');
  });

  it('تبديل المتجر يفرغ اللوحة ويجلب للمتجر الجديد، ورد المتجر القديم المتأخر يُهمَل', async () => {
    let releaseOld: (v: unknown) => void = () => {};
    api.fetchBoard.mockReturnValueOnce(new Promise((r) => { releaseOld = r; })).mockResolvedValueOnce(data('new-store'));
    const { result, rerender } = renderHook(({ s }) => useReceptionBoard({ storefrontId: s, enabled: true, revision: 0 }), { initialProps: { s: 's1' } });
    await tick();
    rerender({ s: 's2' });
    await tick();
    expect(api.fetchBoard).toHaveBeenLastCalledWith('s2');
    await act(async () => { releaseOld(data('old-store')); await vi.advanceTimersByTimeAsync(0); });
    expect(result.current.orders.map((o) => o.id)).toEqual(['new-store']);
  });
});
