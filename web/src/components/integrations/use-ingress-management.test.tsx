// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useIngressManagement } from './use-ingress-management';
import type { IngressPoint } from '@/lib/signed-ingress';
import type { SignedIngressState } from './use-signed-ingress';

const { rotateIngressSecret, disableIngress, createIngressPoint } = vi.hoisted(() => ({ rotateIngressSecret: vi.fn(), disableIngress: vi.fn(), createIngressPoint: vi.fn() }));
vi.mock('@/lib/ingress-operations', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ingress-operations')>('@/lib/ingress-operations');
  return { ...actual, rotateIngressSecret, disableIngress, createIngressPoint };
});

const point: IngressPoint = { id: 'ing-1', storeId: 'Store-100', branchId: null, status: 'configured', secretVersion: 1, createdAt: null, disabledAt: null };

beforeEach(() => { rotateIngressSecret.mockReset(); disableIngress.mockReset(); createIngressPoint.mockReset(); });

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
    expect(result.current.reveal).toEqual({ value: 'SENTINEL_HOOK_SECRET', storeId: 'Store-100', kind: 'rotated' });
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

  describe('create', () => {
    const ready = (points: IngressPoint[]): SignedIngressState => ({ status: 'ready', points, canViewBranches: false, branchNames: null });
    const born: IngressPoint = { ...point, id: 'ing-new', storeId: 'Store-NEW', secretVersion: 1 };

    it('the list shown at the moment of failure (same object) never decides; only a different, later state does', async () => {
      createIngressPoint.mockRejectedValue(new TypeError('Failed to fetch'));
      const reload = vi.fn();
      const { result } = renderHook(() => useIngressManagement(reload, 'prof-1'));
      const stale = ready([point]);
      act(() => result.current.observe(stale));
      act(() => result.current.openCreate());
      await act(async () => result.current.confirmCreate({ storeId: 'Store-NEW', branchId: null }));
      expect(result.current.createOpen).toBe(false);
      expect(result.current.notice).toEqual({ kind: 'error', messageKey: 'outcomeUnknown' });
      expect(reload).toHaveBeenCalledTimes(1);

      // نفس الكائن (حتى لو أُعيد استدعاء observe به) وحالة التحميل لا يُسوّيان شيئاً.
      act(() => result.current.observe(stale));
      act(() => result.current.observe({ status: 'loading' }));
      expect(result.current.notice).toEqual({ kind: 'error', messageKey: 'outcomeUnknown' });

      // قراءة جديدة (كائن جديد): النقطة ظهرت بالإصدار 1 فتُسوّى «السرّ ضاع» دون أي تدوير تلقائي.
      act(() => result.current.observe(ready([point, born])));
      expect(result.current.notice).toEqual({ kind: 'createLost', storeId: 'Store-NEW' });
      expect(rotateIngressSecret).not.toHaveBeenCalled();
      expect(createIngressPoint).toHaveBeenCalledTimes(1);
    });

    it('a point that appeared in another state (disabled, or not version 1) is not claimed as the lost creation', async () => {
      createIngressPoint.mockRejectedValue(Object.assign(new Error('x'), { status: 503 }));
      const { result } = renderHook(() => useIngressManagement(() => {}, 'prof-1'));
      act(() => result.current.observe(ready([point])));
      act(() => result.current.openCreate());
      await act(async () => result.current.confirmCreate({ storeId: 'Store-NEW', branchId: null }));
      act(() => result.current.observe(ready([point, { ...born, secretVersion: 2 }])));
      expect(result.current.notice).toEqual({ kind: 'createUnconfirmed', storeId: 'Store-NEW' });
    });

    it('a fresh list that does NOT contain the point never means the creation failed: a neutral "unconfirmed" notice, no failure kind, no rotate, no second create', async () => {
      createIngressPoint.mockRejectedValue(new TypeError('Failed to fetch'));
      const { result } = renderHook(() => useIngressManagement(() => {}, 'prof-1'));
      act(() => result.current.observe(ready([point])));
      act(() => result.current.openCreate());
      await act(async () => result.current.confirmCreate({ storeId: 'Store-NEW', branchId: null }));
      // قائمة جديدة بلا النقطة (قد تكون خارج نطاق فروع المستخدم): غير مؤكَّد، لا «فشل».
      act(() => result.current.observe(ready([point])));
      expect(result.current.notice).toEqual({ kind: 'createUnconfirmed', storeId: 'Store-NEW' });
      expect(JSON.stringify(result.current.notice)).not.toMatch(/absent|failed|notCreated/i);
      expect(rotateIngressSecret).not.toHaveBeenCalled();
      expect(createIngressPoint).toHaveBeenCalledTimes(1);
    });

    it('sends nothing without an active profile or with an invalid store ID, and never twice at once', async () => {
      const { result } = renderHook(() => useIngressManagement(() => {}, null));
      act(() => result.current.openCreate());
      act(() => result.current.confirmCreate({ storeId: 'Store-NEW', branchId: null }));
      expect(createIngressPoint).not.toHaveBeenCalled();
      expect(result.current.createError).toBe('profileUnavailable');

      const withProfile = renderHook(() => useIngressManagement(() => {}, 'prof-1'));
      act(() => withProfile.result.current.openCreate());
      act(() => withProfile.result.current.confirmCreate({ storeId: '   ', branchId: null }));
      expect(createIngressPoint).not.toHaveBeenCalled();

      let release: (v: { value: string }) => void = () => {};
      createIngressPoint.mockReturnValue(new Promise((resolve) => { release = resolve; }));
      act(() => { withProfile.result.current.confirmCreate({ storeId: 'A', branchId: null }); withProfile.result.current.confirmCreate({ storeId: 'A', branchId: null }); });
      expect(createIngressPoint).toHaveBeenCalledTimes(1);
      await act(async () => release({ value: 'S' }));
      expect(withProfile.result.current.reveal).toEqual({ value: 'S', storeId: 'A', kind: 'created' });
    });
  });
});
