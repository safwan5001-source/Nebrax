// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useIngressManagement } from './use-ingress-management';
import type { IngressPoint } from '@/lib/signed-ingress';

const { rotateIngressSecret, disableIngress } = vi.hoisted(() => ({ rotateIngressSecret: vi.fn(), disableIngress: vi.fn() }));
vi.mock('@/lib/ingress-operations', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ingress-operations')>('@/lib/ingress-operations');
  return { ...actual, rotateIngressSecret, disableIngress };
});

const point: IngressPoint = { id: 'ing-1', storeId: 'Store-100', branchId: null, status: 'configured', secretVersion: 1, createdAt: null, disabledAt: null };

beforeEach(() => { rotateIngressSecret.mockReset(); disableIngress.mockReset(); });

describe('useIngressManagement', () => {
  it('confirmDisable ignores anything but the exact store ID (a hook-level guard, independent of the dialog)', async () => {
    const { result } = renderHook(() => useIngressManagement(() => {}));
    act(() => result.current.openDisable(point));
    for (const typed of ['', 'store-100', 'Store-100 ', 'Store-1000']) {
      act(() => result.current.confirmDisable(typed));
    }
    expect(disableIngress).not.toHaveBeenCalled();
    expect(result.current.busy).toBe(false);

    disableIngress.mockResolvedValue(undefined);
    await act(async () => result.current.confirmDisable('Store-100'));
    expect(disableIngress).toHaveBeenCalledTimes(1);
    expect(disableIngress).toHaveBeenCalledWith('ing-1');
  });

  it('confirm actions do nothing without the matching open dialog', () => {
    const { result } = renderHook(() => useIngressManagement(() => {}));
    act(() => { result.current.confirmRotate(); result.current.confirmDisable('Store-100'); });
    expect(rotateIngressSecret).not.toHaveBeenCalled();
    expect(disableIngress).not.toHaveBeenCalled();
    act(() => result.current.openRotate(point));
    act(() => result.current.confirmDisable('Store-100'));
    expect(disableIngress).not.toHaveBeenCalled();
  });

  it('holds the secret only until the reveal is closed, and never keeps it anywhere else in its state', async () => {
    rotateIngressSecret.mockResolvedValue({ value: 'SENTINEL_HOOK_SECRET' });
    const reload = vi.fn();
    const { result } = renderHook(() => useIngressManagement(reload));
    act(() => result.current.openRotate(point));
    await act(async () => result.current.confirmRotate());
    expect(result.current.reveal).toEqual({ value: 'SENTINEL_HOOK_SECRET', storeId: 'Store-100' });
    expect(result.current.dialog).toBeNull();
    expect(JSON.stringify({ ...result.current, reveal: null })).not.toContain('SENTINEL_HOOK_SECRET');
    expect(reload).toHaveBeenCalledTimes(1);

    act(() => result.current.closeReveal());
    expect(result.current.reveal).toBeNull();
    expect(JSON.stringify(result.current)).not.toContain('SENTINEL_HOOK_SECRET');
    expect(result.current.notice).toEqual({ kind: 'rotated', storeId: 'Store-100' });
  });

  it('refuses to open a new dialog or cancel while a request is in flight', async () => {
    let release: (v: { value: string }) => void = () => {};
    rotateIngressSecret.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    const { result } = renderHook(() => useIngressManagement(() => {}));
    act(() => result.current.openRotate(point));
    act(() => result.current.confirmRotate());
    expect(result.current.busy).toBe(true);
    act(() => { result.current.cancel(); result.current.openDisable(point); });
    expect(result.current.dialog?.kind).toBe('rotate');
    await act(async () => release({ value: 'S' }));
    expect(result.current.busy).toBe(false);
  });

  it('a rotate failure with an unknown outcome re-reads the list and sets only a dictionary key', async () => {
    rotateIngressSecret.mockRejectedValue(new TypeError('Failed to fetch SENTINEL_RAW'));
    const reload = vi.fn();
    const { result } = renderHook(() => useIngressManagement(reload));
    act(() => result.current.openRotate(point));
    await act(async () => result.current.confirmRotate());
    expect(result.current.notice).toEqual({ kind: 'error', messageKey: 'outcomeUnknown' });
    expect(JSON.stringify(result.current)).not.toContain('SENTINEL_RAW');
    expect(reload).toHaveBeenCalledTimes(1);
    expect(rotateIngressSecret).toHaveBeenCalledTimes(1);
  });
});
