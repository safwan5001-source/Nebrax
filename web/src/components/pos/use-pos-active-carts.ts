'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  appendPosActiveCart,
  cartHasUnsavedData,
  closePosActiveCart,
  createPosActiveCart,
  type PosActiveCart,
  type PosCartLine,
} from '@/lib/pos-active-cart';
import {
  clearPosCartSnapshotSync,
  parsePosCartSnapshot,
  serializePosCartSnapshot,
  type PosCartRestoreStatus,
  type PosCartSnapshotScope,
  type PosPendingCheckoutAttempt,
} from '@/lib/pos-cart-snapshot';

export type { PosActiveCart, PosCartLine };
export {
  appendPosActiveCart,
  cartHasUnsavedData,
  closePosActiveCart,
  createPosActiveCart,
};

/** توافق رجعي: الشكل القديم `{carts,activeId}` عبر عقد اللقطة مع نطاق وهمي للمفتاح. */
export function parseStoredPosActiveCarts(value: string): { carts: PosActiveCart[]; activeId: string } | null {
  const dummyScope: PosCartSnapshotScope = {
    tenantId: '_',
    branchId: '_',
    deviceId: '_',
    warehouseId: '_',
    shiftId: '_',
    sessionId: '_',
    userId: '_',
  };
  try {
    const parsed = JSON.parse(value) as { v?: unknown };
    // الشكل القديم بلا v — parsePosCartSnapshot يقبله عند أي نطاق متوقع.
    if (parsed.v === undefined) {
      const result = parsePosCartSnapshot(value, dummyScope, false);
      if (result.status !== 'restored') return null;
      return { carts: result.carts, activeId: result.activeId };
    }
    // v1 يحتاج نطاقاً مطابقاً؛ للاختبارات القديمة بلا نطاق نقرأ الشكل مباشرة.
    const legacy = JSON.parse(value) as { carts?: unknown; activeId?: unknown; scope?: PosCartSnapshotScope };
    if (legacy.scope) {
      const result = parsePosCartSnapshot(value, legacy.scope, false);
      if (result.status !== 'restored') return null;
      return { carts: result.carts, activeId: result.activeId };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * السلات النشطة مسودات واجهية فقط. تحفظ كل سلة بصورة مستقلة ولا تُصبح مصدراً
 * مالياً؛ يبقى الخادم حارس السعر والمخزون والدفع عند checkout أو التعليق.
 */
export function usePosActiveCarts({
  storageKey,
  scope,
  defaultTaxInclusive,
}: {
  storageKey: string | null;
  scope: PosCartSnapshotScope | null;
  defaultTaxInclusive: boolean;
}) {
  const initial = useMemo(() => createPosActiveCart(1, defaultTaxInclusive), [defaultTaxInclusive]);
  const [carts, setCarts] = useState<PosActiveCart[]>([initial]);
  const [activeCartId, setActiveCartId] = useState(initial.id);
  const [pendingAttempt, setPendingAttemptState] = useState<PosPendingCheckoutAttempt | null>(null);
  const [restoreStatus, setRestoreStatus] = useState<PosCartRestoreStatus>('fresh');
  const loadedKeyRef = useRef<string | null>(null);
  // المفتاح الذي اكتملت استعادته من التخزين المحلي؛ مصدر إشارة `hydrated`
  // حتى لا يكتب مستهلك (كالعميل الافتراضي) فوق سلة قبل استبدالها بالمستعادة.
  const [hydratedKey, setHydratedKey] = useState<string | null>(null);
  const pendingAttemptRef = useRef<PosPendingCheckoutAttempt | null>(null);
  const skipPersistRef = useRef(false);

  useEffect(() => {
    if (!storageKey || !scope || loadedKeyRef.current === storageKey) return;
    const stored = localStorage.getItem(storageKey);
    const parsed = parsePosCartSnapshot(stored, scope, defaultTaxInclusive);
    if (parsed.status === 'ignored_invalid' || parsed.status === 'ignored_stale' || parsed.status === 'ignored_scope') {
      clearPosCartSnapshotSync(storageKey);
    }
    setCarts(parsed.carts);
    setActiveCartId(parsed.activeId);
    pendingAttemptRef.current = parsed.pendingAttempt;
    setPendingAttemptState(parsed.pendingAttempt);
    setRestoreStatus(parsed.status);
    loadedKeyRef.current = storageKey;
    setHydratedKey(storageKey);
  }, [defaultTaxInclusive, scope, storageKey]);

  useEffect(() => {
    if (!storageKey || !scope || loadedKeyRef.current !== storageKey) return;
    if (skipPersistRef.current) {
      skipPersistRef.current = false;
      return;
    }
    try {
      localStorage.setItem(storageKey, serializePosCartSnapshot({
        scope,
        carts,
        activeId: activeCartId,
        pendingAttempt: pendingAttemptRef.current,
      }));
    } catch {
      // الإتاحة المحلية تحسين استمرارية فقط؛ لا تمنع البيع عند امتلاء التخزين.
    }
  }, [activeCartId, carts, scope, storageKey]);

  const activeCart = carts.find((cart) => cart.id === activeCartId) ?? carts[0];

  const patchActive = useCallback((patch: Partial<PosActiveCart>) => {
    setCarts((current) => current.map((cart) => cart.id === activeCartId ? { ...cart, ...patch } : cart));
  }, [activeCartId]);

  const updateActiveItems = useCallback((updater: (items: PosCartLine[]) => PosCartLine[]) => {
    setCarts((current) => current.map((cart) => cart.id === activeCartId ? { ...cart, items: updater(cart.items) } : cart));
  }, [activeCartId]);

  const updateCarts = useCallback((updater: (current: PosActiveCart[]) => PosActiveCart[]) => {
    setCarts(updater);
  }, []);

  const openCart = useCallback((cart: PosActiveCart) => {
    setCarts((current) => appendPosActiveCart(current, cart));
    setActiveCartId(cart.id);
  }, []);

  const createCart = useCallback(() => {
    const next = createPosActiveCart(Math.max(0, ...carts.map((cart) => cart.number)) + 1, defaultTaxInclusive);
    setCarts((current) => [...current, next]);
    setActiveCartId(next.id);
    return next.id;
  }, [carts, defaultTaxInclusive]);

  const closeCart = useCallback((idToClose: string) => {
    const next = closePosActiveCart(carts, activeCartId, idToClose, defaultTaxInclusive);
    if (pendingAttemptRef.current?.cartId === idToClose) {
      pendingAttemptRef.current = null;
      setPendingAttemptState(null);
    }
    setCarts(next.carts);
    setActiveCartId(next.activeId);
  }, [activeCartId, carts, defaultTaxInclusive]);

  const setPendingAttempt = useCallback((next: PosPendingCheckoutAttempt | null) => {
    pendingAttemptRef.current = next;
    setPendingAttemptState(next);
    if (!storageKey || !scope || loadedKeyRef.current !== storageKey) return;
    try {
      localStorage.setItem(storageKey, serializePosCartSnapshot({
        scope,
        carts,
        activeId: activeCartId,
        pendingAttempt: next,
      }));
    } catch {
      // ignore
    }
  }, [activeCartId, carts, scope, storageKey]);

  /** يطبّق نتيجة markSaleClearedSync على الحالة ويتخطى كتابة أثر مزدوجة. */
  const applyClearedSaleState = useCallback((next: { carts: PosActiveCart[]; activeId: string }) => {
    skipPersistRef.current = true;
    pendingAttemptRef.current = null;
    setPendingAttemptState(null);
    setCarts(next.carts);
    setActiveCartId(next.activeId);
  }, []);

  return {
    carts,
    activeCart,
    activeCartId,
    pendingAttempt,
    restoreStatus,
    // صحيح فقط بعد أن يستقر التخزين المحلي للمفتاح الحالي (وليس لمفتاح سابق).
    hydrated: hydratedKey !== null && hydratedKey === storageKey,
    setActiveCartId,
    patchActive,
    updateActiveItems,
    updateCarts,
    openCart,
    createCart,
    closeCart,
    setPendingAttempt,
    applyClearedSaleState,
  };
}
