'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { isPosEditableTarget } from '@/components/pos/interactions/editable-target';
import type { PosFocusZone } from '@/components/pos/interactions/pos-interaction-context';

export interface PosFocusManager {
  registerSearchInput: (element: HTMLInputElement | null) => void;
  registerProductsContainer: (element: HTMLElement | null) => void;
  registerProductButton: (index: number, element: HTMLButtonElement | null) => void;
  registerCartContainer: (element: HTMLElement | null) => void;
  registerCartLine: (lineKey: string, element: HTMLElement | null) => void;
  activeZone: PosFocusZone;
  focusSearch: () => void;
  focusZone: (zone: PosFocusZone, options?: { productIndex?: number; cartLineKey?: string }) => void;
  getActiveZone: () => PosFocusZone;
  restoreFocusSafe: () => boolean;
  /** @deprecated استخدم restoreFocusSafe */
  restoreSearchFocus: () => boolean;
}

export function usePosFocusManager(): PosFocusManager {
  const searchInputRef = useRef<HTMLInputElement | null>(null);
  const productsContainerRef = useRef<HTMLElement | null>(null);
  const productButtonsRef = useRef<Map<number, HTMLButtonElement>>(new Map());
  const cartContainerRef = useRef<HTMLElement | null>(null);
  const cartLinesRef = useRef<Map<string, HTMLElement>>(new Map());
  const [activeZone, setActiveZone] = useState<PosFocusZone>('search');

  const registerSearchInput = useCallback((element: HTMLInputElement | null) => {
    searchInputRef.current = element;
  }, []);

  const registerProductsContainer = useCallback((element: HTMLElement | null) => {
    productsContainerRef.current = element;
  }, []);

  const registerProductButton = useCallback((index: number, element: HTMLButtonElement | null) => {
    if (element) productButtonsRef.current.set(index, element);
    else productButtonsRef.current.delete(index);
  }, []);

  const registerCartContainer = useCallback((element: HTMLElement | null) => {
    cartContainerRef.current = element;
  }, []);

  const registerCartLine = useCallback((lineKey: string, element: HTMLElement | null) => {
    if (element) cartLinesRef.current.set(lineKey, element);
    else cartLinesRef.current.delete(lineKey);
  }, []);

  const focusSearch = useCallback(() => {
    searchInputRef.current?.focus();
    setActiveZone('search');
  }, []);

  const focusZone = useCallback((zone: PosFocusZone, options?: { productIndex?: number; cartLineKey?: string }) => {
    setActiveZone(zone);
    if (zone === 'search') {
      searchInputRef.current?.focus();
      return;
    }
    if (zone === 'products') {
      const index = options?.productIndex ?? 0;
      const button = productButtonsRef.current.get(index) ?? productsContainerRef.current;
      button?.focus();
      return;
    }
    if (zone === 'cart') {
      const line = options?.cartLineKey ? cartLinesRef.current.get(options.cartLineKey) : undefined;
      (line ?? cartContainerRef.current)?.focus();
    }
  }, []);

  const getActiveZone = useCallback(() => activeZone, [activeZone]);

  const restoreFocusSafe = useCallback(() => {
    const active = document.activeElement;
    if (isPosEditableTarget(active)) return false;
    if (active?.closest('[role="dialog"]')) return false;
    if (activeZone === 'cart') {
      cartContainerRef.current?.focus();
      return Boolean(cartContainerRef.current);
    }
    if (activeZone === 'products') {
      const first = productButtonsRef.current.get(0) ?? productsContainerRef.current;
      first?.focus();
      return Boolean(first);
    }
    const input = searchInputRef.current;
    if (!input) return false;
    input.focus();
    setActiveZone('search');
    return true;
  }, [activeZone]);

  return useMemo(
    () => ({
      registerSearchInput,
      registerProductsContainer,
      registerProductButton,
      registerCartContainer,
      registerCartLine,
      activeZone,
      focusSearch,
      focusZone,
      getActiveZone,
      restoreFocusSafe,
      restoreSearchFocus: restoreFocusSafe,
    }),
    [
      activeZone,
      focusSearch,
      focusZone,
      getActiveZone,
      registerCartContainer,
      registerCartLine,
      registerProductButton,
      registerProductsContainer,
      registerSearchInput,
      restoreFocusSafe,
    ],
  );
}
