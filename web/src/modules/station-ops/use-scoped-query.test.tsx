// @vitest-environment jsdom
import { act, cleanup, renderHook, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { StationOpsError } from './read-client';
import { useScopedQuery } from './use-scoped-query';

afterEach(cleanup);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

describe('useScopedQuery — no cross-key leakage', () => {
  it('shows loading (never the previous key\'s data) in the very render after the key changes', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const { result, rerender } = renderHook(({ k }) => useScopedQuery(k, () => (k === 'A' ? first.promise : second.promise)), { initialProps: { k: 'A' } });
    await act(async () => { first.resolve('data-A'); await first.promise; });
    expect(result.current.state).toEqual({ status: 'success', data: 'data-A' });

    rerender({ k: 'B' });
    // الإطار الأول بعد التبديل: لا بيانات A إطلاقاً.
    expect(result.current.state.status).toBe('loading');

    await act(async () => { second.resolve('data-B'); await second.promise; });
    expect(result.current.state).toEqual({ status: 'success', data: 'data-B' });
  });

  it('ignores a late response that belongs to a previous key', async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const { result, rerender } = renderHook(({ k }) => useScopedQuery(k, () => (k === 'A' ? first.promise : second.promise)), { initialProps: { k: 'A' } });
    rerender({ k: 'B' });
    await act(async () => { second.resolve('data-B'); await second.promise; });
    await act(async () => { first.resolve('stale-A'); await first.promise; });
    expect(result.current.state).toEqual({ status: 'success', data: 'data-B' });
  });

  it('aborts the in-flight request when the key changes or the component unmounts', async () => {
    const signals: AbortSignal[] = [];
    const fetcher = vi.fn((signal: AbortSignal) => { signals.push(signal); return new Promise<string>(() => {}); });
    const { rerender, unmount } = renderHook(({ k }) => useScopedQuery(k, fetcher), { initialProps: { k: 'A' } });
    rerender({ k: 'B' });
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
    unmount();
    expect(signals[1].aborted).toBe(true);
  });

  it('does not fetch with a null key and stays in loading', () => {
    const fetcher = vi.fn(async () => 'x');
    const { result } = renderHook(() => useScopedQuery(null, fetcher));
    expect(fetcher).not.toHaveBeenCalled();
    expect(result.current.state.status).toBe('loading');
  });

  it('classifies failures and retries on reload', async () => {
    let attempt = 0;
    const fetcher = vi.fn(async () => {
      attempt += 1;
      if (attempt === 1) throw new TypeError('Failed to fetch');
      return 'ok';
    });
    const { result } = renderHook(() => useScopedQuery('K', fetcher));
    await waitFor(() => expect(result.current.state.status).toBe('error'));
    expect(result.current.state).toMatchObject({ error: expect.any(StationOpsError) });
    expect((result.current.state as { error: StationOpsError }).error.kind).toBe('offline');
    act(() => result.current.reload());
    await waitFor(() => expect(result.current.state).toEqual({ status: 'success', data: 'ok' }));
  });

  it('swallows aborts without surfacing an error', async () => {
    const abort = Object.assign(new Error('aborted'), { name: 'AbortError' });
    const { result } = renderHook(() => useScopedQuery('K', async () => { throw abort; }));
    await act(async () => { await Promise.resolve(); });
    expect(result.current.state.status).toBe('loading');
  });
});
