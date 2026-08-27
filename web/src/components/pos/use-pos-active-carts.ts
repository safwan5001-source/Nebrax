'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type { PosCustomer } from '@/components/pos/customer-picker';

export interface PosCartLine {
  key: string;
  productId: string | null;
  description: string;
  sku: string | null;
  unit: string | null;
  price: string;
  qty: number;
  tax: number;
  discount: string;
}

export interface PosActiveCart {
  id: string;
  number: number;
  items: PosCartLine[];
  customer: PosCustomer | null;
  note: string;
  taxInclusive: boolean;
}

function id(): string {
  return typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `cart-${Date.now()}-${Math.random().toString(36).slice(2, 10)}`;
}

export function createPosActiveCart(number: number, taxInclusive: boolean): PosActiveCart {
  return { id: id(), number, items: [], customer: null, note: '', taxInclusive };
}

export function cartHasUnsavedData(cart: PosActiveCart): boolean {
  return cart.items.length > 0 || cart.customer !== null || cart.note.trim().length > 0;
}

export function parseStoredPosActiveCarts(value: string): { carts: PosActiveCart[]; activeId: string } | null {
  try {
    const parsed = JSON.parse(value) as { carts?: unknown; activeId?: unknown };
    if (!Array.isArray(parsed.carts) || parsed.carts.length === 0 || typeof parsed.activeId !== 'string') return null;
    const carts = parsed.carts.filter((cart): cart is PosActiveCart => (
      typeof cart === 'object' && cart !== null
      && typeof (cart as PosActiveCart).id === 'string'
      && typeof (cart as PosActiveCart).number === 'number'
      && Array.isArray((cart as PosActiveCart).items)
      && typeof (cart as PosActiveCart).note === 'string'
      && typeof (cart as PosActiveCart).taxInclusive === 'boolean'
    ));
    if (carts.length === 0 || !carts.some((cart) => cart.id === parsed.activeId)) return null;
    return { carts, activeId: parsed.activeId };
  } catch {
    return null;
  }
}

/** تضمن أن استعادة عملية معلّقة لا تنسخ السلة نفسها عند النقر المتكرر. */
export function appendPosActiveCart(carts: PosActiveCart[], cart: PosActiveCart): PosActiveCart[] {
  return carts.some((current) => current.id === cart.id) ? carts : [...carts, cart];
}

/** إغلاق سلة لا يترك شاشة بلا سلة؛ آخر سلة تُستبدل بمسودة جديدة مستقلة. */
export function closePosActiveCart(carts: PosActiveCart[], activeId: string, idToClose: string, defaultTaxInclusive: boolean): { carts: PosActiveCart[]; activeId: string } {
  const remaining = carts.filter((cart) => cart.id !== idToClose);
  if (remaining.length > 0) {
    return { carts: remaining, activeId: idToClose === activeId ? remaining[0].id : activeId };
  }

  const fresh = createPosActiveCart(1, defaultTaxInclusive);
  return { carts: [fresh], activeId: fresh.id };
}

/**
 * السلات النشطة مسودات واجهية فقط. تحفظ كل سلة بصورة مستقلة ولا تُصبح مصدراً
 * مالياً؛ يبقى الخادم حارس السعر والمخزون والدفع عند checkout أو التعليق.
 */
export function usePosActiveCarts({ storageKey, defaultTaxInclusive }: { storageKey: string | null; defaultTaxInclusive: boolean }) {
  const initial = useMemo(() => createPosActiveCart(1, defaultTaxInclusive), [defaultTaxInclusive]);
  const [carts, setCarts] = useState<PosActiveCart[]>([initial]);
  const [activeCartId, setActiveCartId] = useState(initial.id);
  const loadedKeyRef = useRef<string | null>(null);
  // المفتاح الذي اكتملت استعادته من التخزين المحلي؛ مصدر إشارة `hydrated`
  // حتى لا يكتب مستهلك (كالعميل الافتراضي) فوق سلة قبل استبدالها بالمستعادة.
  const [hydratedKey, setHydratedKey] = useState<string | null>(null);

  useEffect(() => {
    if (!storageKey || loadedKeyRef.current === storageKey) return;
    const stored = localStorage.getItem(storageKey);
    const parsed = stored ? parseStoredPosActiveCarts(stored) : null;
    if (parsed) {
      setCarts(parsed.carts);
      setActiveCartId(parsed.activeId);
    } else {
      const fresh = createPosActiveCart(1, defaultTaxInclusive);
      setCarts([fresh]);
      setActiveCartId(fresh.id);
    }
    loadedKeyRef.current = storageKey;
    setHydratedKey(storageKey);
  }, [defaultTaxInclusive, storageKey]);

  useEffect(() => {
    if (!storageKey || loadedKeyRef.current !== storageKey) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify({ carts, activeId: activeCartId }));
    } catch {
      // الإتاحة المحلية تحسين استمرارية فقط؛ لا تمنع البيع عند امتلاء التخزين.
    }
  }, [activeCartId, carts, storageKey]);

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
    setCarts(next.carts);
    setActiveCartId(next.activeId);
  }, [activeCartId, carts, defaultTaxInclusive]);

  return {
    carts,
    activeCart,
    activeCartId,
    // صحيح فقط بعد أن يستقر التخزين المحلي للمفتاح الحالي (وليس لمفتاح سابق).
    hydrated: hydratedKey !== null && hydratedKey === storageKey,
    setActiveCartId,
    patchActive,
    updateActiveItems,
    updateCarts,
    openCart,
    createCart,
    closeCart,
  };
}
