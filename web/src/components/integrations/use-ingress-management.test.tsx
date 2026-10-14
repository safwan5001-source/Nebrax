// @vitest-environment jsdom
import { act, renderHook } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useIngressManagement } from './use-ingress-management';
import { resetUnconfirmedCreatesForTests } from '@/lib/ingress-create-guard';
import type { IngressPoint } from '@/lib/signed-ingress';
import type { SignedIngressState } from './use-signed-ingress';

const { rotateIngressSecret, disableIngress, createIngressPoint, reassignIngressOperator } = vi.hoisted(() => ({ rotateIngressSecret: vi.fn(), disableIngress: vi.fn(), createIngressPoint: vi.fn(), reassignIngressOperator: vi.fn() }));
vi.mock('@/lib/ingress-operations', async () => {
  const actual = await vi.importActual<typeof import('@/lib/ingress-operations')>('@/lib/ingress-operations');
  return { ...actual, rotateIngressSecret, disableIngress, createIngressPoint, reassignIngressOperator };
});

const point: IngressPoint = { id: 'ing-1', storeId: 'Store-100', branchId: null, status: 'configured', secretVersion: 1, createdAt: null, disabledAt: null };

beforeEach(() => { resetUnconfirmedCreatesForTests(); rotateIngressSecret.mockReset(); disableIngress.mockReset(); createIngressPoint.mockReset(); reassignIngressOperator.mockReset(); });

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

    it('after an unknown outcome the hook itself refuses to send the same store ID again (even if the dialog guard is bypassed), but allows a different one', async () => {
      createIngressPoint.mockRejectedValueOnce(new TypeError('Failed to fetch'));
      const { result } = renderHook(() => useIngressManagement(() => {}, 'prof-1', 'keeta'));
      act(() => result.current.observe(ready([point])));
      act(() => result.current.openCreate());
      await act(async () => result.current.confirmCreate({ storeId: 'Store-NEW', branchId: null }));
      expect(createIngressPoint).toHaveBeenCalledTimes(1);
      expect(result.current.blockedStoreIds).toEqual(['Store-NEW']);
      expect(result.current.isCreateBlocked(' Store-NEW ')).toBe(true);
      expect(result.current.isCreateBlocked('Other')).toBe(false);

      act(() => result.current.dismissNotice());
      act(() => result.current.openCreate());
      act(() => result.current.confirmCreate({ storeId: 'Store-NEW', branchId: null }));
      expect(createIngressPoint).toHaveBeenCalledTimes(1);
      expect(result.current.createError).toBe('createBlocked');

      createIngressPoint.mockResolvedValueOnce({ value: 'S' });
      await act(async () => result.current.confirmCreate({ storeId: 'Other', branchId: null }));
      expect(createIngressPoint).toHaveBeenCalledTimes(2);
    });

    it('an absent point (fresh list) never lifts the block; the point itself appearing in a later fresh list does', async () => {
      createIngressPoint.mockRejectedValue(new TypeError('Failed to fetch'));
      const { result } = renderHook(() => useIngressManagement(() => {}, 'prof-1', 'keeta'));
      const stale = ready([point]);
      act(() => result.current.observe(stale));
      act(() => result.current.openCreate());
      await act(async () => result.current.confirmCreate({ storeId: 'Store-NEW', branchId: null }));
      // القائمة القديمة لحظة الفشل (الكائن نفسه) لا ترفع شيئاً حتى لو حوت المعرّف.
      act(() => result.current.observe(stale));
      expect(result.current.blockedStoreIds).toEqual(['Store-NEW']);
      act(() => result.current.observe(ready([point])));
      expect(result.current.notice).toEqual({ kind: 'createUnconfirmed', storeId: 'Store-NEW' });
      expect(result.current.blockedStoreIds).toEqual(['Store-NEW']);
      act(() => result.current.observe(ready([point])));
      expect(result.current.blockedStoreIds).toEqual(['Store-NEW']);
      // لاحقاً تظهر النقطة نفسها (مثلاً بعد تحديث يدوي): تُرفع الحماية لأنها معروفة ومرئية، والإشعار المحايد لا يتغيّر.
      act(() => result.current.observe(ready([point, born])));
      expect(result.current.blockedStoreIds).toEqual([]);
      expect(result.current.notice).toEqual({ kind: 'createUnconfirmed', storeId: 'Store-NEW' });
    });
  });
});

describe('useIngressManagement — reassign (5d)', () => {
  const operatorsReady = {
    status: 'ready' as const,
    entries: [
      { id: 'u-old', name: 'Old', active: true, branchIds: [] },
      { id: 'u-new', name: 'New', active: true, branchIds: [] },
      { id: 'u-off', name: 'Off', active: false, branchIds: [] },
      { id: 'u-br', name: 'Branch2', active: true, branchIds: ['br-2'] },
    ],
  };
  const operated: IngressPoint = { ...point, operatedBy: 'u-old' };
  const mountReady = (reload = () => {}, retry = () => {}) => renderHook(() => useIngressManagement(reload, null, 'keeta', operatorsReady, retry));

  it('two confirms in the same tick send one request (the lock is raised before the first await)', async () => {
    let release: (v?: unknown) => void = () => {};
    reassignIngressOperator.mockImplementation(() => new Promise((resolve) => { release = resolve; }));
    const { result } = mountReady();
    act(() => result.current.openReassign(operated));
    act(() => { result.current.confirmReassign('u-new'); result.current.confirmReassign('u-new'); });
    expect(reassignIngressOperator).toHaveBeenCalledTimes(1);
    expect(reassignIngressOperator).toHaveBeenCalledWith('ing-1', 'u-new');
    expect(result.current.busy).toBe(true);
    // مشغولاً: لا إغلاق ولا فتح جديد.
    act(() => { result.current.cancelReassign(); result.current.openReassign({ ...operated, id: 'ing-2' }); });
    expect(result.current.reassignPoint?.id).toBe('ing-1');
    await act(async () => { release({}); });
    expect(result.current.reassignPoint).toBeNull();
    expect(result.current.busy).toBe(false);
  });

  it.each([['an inactive user', 'u-off'], ['the current operator', 'u-old'], ['a user outside the point scope', 'u-br'], ['an unknown id', 'u-ghost'], ['an empty id', ''], ['a path-like id', '../x']])('never sends for %s', (_name, id) => {
    const { result } = mountReady();
    act(() => result.current.openReassign(operated));
    act(() => result.current.confirmReassign(id));
    expect(reassignIngressOperator).not.toHaveBeenCalled();
    expect(result.current.busy).toBe(false);
  });

  it('never sends while the operator directory is not ready', () => {
    const { result } = renderHook(() => useIngressManagement(() => {}, null, 'keeta', { status: 'loading' }));
    act(() => result.current.openReassign(operated));
    act(() => result.current.confirmReassign('u-new'));
    expect(reassignIngressOperator).not.toHaveBeenCalled();
  });

  it('success closes the dialog, records the new operator NAME only, and re-reads the list once', async () => {
    reassignIngressOperator.mockResolvedValue(undefined);
    const reload = vi.fn();
    const { result } = mountReady(reload);
    act(() => result.current.openReassign(operated));
    await act(async () => result.current.confirmReassign('u-new'));
    expect(result.current.notice).toEqual({ kind: 'reassigned', storeId: 'Store-100', operatorName: 'New' });
    expect(JSON.stringify(result.current.notice)).not.toContain('u-new');
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('a known 422 keeps the dialog open, exposes the safe key and refreshes the directory; no automatic retry', async () => {
    reassignIngressOperator.mockRejectedValue(Object.assign(new Error('x'), { status: 422, body: { error_code: 'operator_ineligible' } }));
    const retry = vi.fn();
    const { result } = mountReady(() => {}, retry);
    act(() => result.current.openReassign(operated));
    await act(async () => result.current.confirmReassign('u-new'));
    expect(result.current.reassignError).toBe('operatorIneligible');
    expect(result.current.reassignPoint).not.toBeNull();
    expect(retry).toHaveBeenCalledTimes(1);
    expect(reassignIngressOperator).toHaveBeenCalledTimes(1);
  });

  it.each([[403, 'forbidden'], [404, 'notFound']])('%s closes the dialog with a notice and re-reads', async (status, key) => {
    reassignIngressOperator.mockRejectedValue(Object.assign(new Error('x'), { status }));
    const reload = vi.fn();
    const { result } = mountReady(reload);
    act(() => result.current.openReassign(operated));
    await act(async () => result.current.confirmReassign('u-new'));
    expect(result.current.notice).toEqual({ kind: 'error', messageKey: key });
    expect(result.current.reassignPoint).toBeNull();
    expect(reload).toHaveBeenCalledTimes(1);
  });

  it('a lost response (network) is an unknown outcome: dialog closed, neutral notice, list re-read, one request', async () => {
    reassignIngressOperator.mockRejectedValue(new TypeError('Failed to fetch'));
    const reload = vi.fn();
    const { result } = mountReady(reload);
    act(() => result.current.openReassign(operated));
    await act(async () => result.current.confirmReassign('u-new'));
    expect(result.current.notice).toEqual({ kind: 'error', messageKey: 'reassignOutcomeUnknown' });
    expect(result.current.reassignPoint).toBeNull();
    expect(reload).toHaveBeenCalledTimes(1);
    expect(reassignIngressOperator).toHaveBeenCalledTimes(1);
  });

  it('eligibleFor mirrors the scope rule and currentOperatorName resolves a name or null', () => {
    const { result } = mountReady();
    expect(result.current.eligibleFor(operated).map((e) => e.id)).toEqual(['u-new']);
    expect(result.current.eligibleFor({ ...operated, branchId: 'br-2' }).map((e) => e.id)).toEqual(['u-br', 'u-new']);
    expect(result.current.currentOperatorName(operated)).toBe('Old');
    expect(result.current.currentOperatorName({ ...operated, operatedBy: 'u-ghost' })).toBeNull();
    expect(result.current.currentOperatorName({ ...operated, operatedBy: null })).toBeNull();
  });
});
