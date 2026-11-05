// @vitest-environment jsdom
import { act, renderHook, waitFor } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { PricesError } from './client';
import { useLoader } from './use-loader';

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('useLoader — one key at a time', () => {
  it('shows loading for the very next render when the key changes (no previous-scope data) and ignores a late reply', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const { result, rerender } = renderHook(({ k, d }) => useLoader(k, () => d.promise), { initialProps: { k: 'a', d: first } });
    expect(result.current.state.status).toBe('loading');

    rerender({ k: 'b', d: second });
    expect(result.current.state.status).toBe('loading');

    await act(async () => { second.resolve('B'); await second.promise; });
    await waitFor(() => expect(result.current.state).toEqual({ status: 'success', data: 'B' }));

    await act(async () => { first.resolve('A'); await first.promise; }); // رد متأخر لمفتاح سابق
    expect(result.current.state).toEqual({ status: 'success', data: 'B' });
  });

  it('never exposes the previous key\'s data even for one render after a switch', async () => {
    const seen: string[] = [];
    const { result, rerender } = renderHook(({ k }) => {
      const loader = useLoader(k, async () => `data-${k}`);
      seen.push(`${k}:${loader.state.status === 'success' ? loader.state.data : loader.state.status}`);
      return loader;
    }, { initialProps: { k: 'a' } });
    await waitFor(() => expect(result.current.state.status).toBe('success'));
    rerender({ k: 'b' });
    await waitFor(() => expect(result.current.state).toEqual({ status: 'success', data: 'data-b' }));
    expect(seen.filter((entry) => entry.startsWith('b:')).every((entry) => entry !== 'b:data-a')).toBe(true);
    expect(seen).not.toContain('b:data-a');
  });

  it('surfaces a classified error and reload retries', async () => {
    let calls = 0;
    const { result } = renderHook(() => useLoader('k', async () => { calls += 1; if (calls === 1) throw new PricesError('offline'); return 'ok'; }));
    await waitFor(() => expect(result.current.state.status).toBe('error'));
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.state).toEqual({ status: 'success', data: 'ok' }));
  });

  it('does not request anything for a null key', () => {
    let called = false;
    renderHook(() => useLoader(null, async () => { called = true; return 1; }));
    expect(called).toBe(false);
  });

  it('refresh() updates silently: never goes back to loading, keeps data when the refresh fails', async () => {
    let n = 0;
    let failNext = false;
    const seen: string[] = [];
    const { result } = renderHook(() => {
      const loader = useLoader('k', async () => { n += 1; if (failNext) throw new PricesError('offline'); return `v${n}`; });
      seen.push(loader.state.status === 'success' ? loader.state.data : loader.state.status);
      return loader;
    });
    await waitFor(() => expect(result.current.state).toEqual({ status: 'success', data: 'v1' }));
    act(() => result.current.refresh());
    await waitFor(() => expect(result.current.state).toEqual({ status: 'success', data: 'v2' }));
    failNext = true;
    act(() => result.current.refresh());
    await waitFor(() => expect(n).toBe(3));
    expect(result.current.state).toEqual({ status: 'success', data: 'v2' }); // فشل التحديث لا يمسح بياناً صالحاً
    expect(seen.slice(seen.indexOf('v1'))).not.toContain('loading'); // ولا وميض تحميل بعد أول نجاح
  });
});
