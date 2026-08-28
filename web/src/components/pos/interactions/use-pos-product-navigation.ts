'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { findGridNeighborIndex, isHorizontalGridEdge, type GridDirection } from '@/components/pos/interactions/grid-navigation';
import { isPosSaleInteractionBlocked, type PosFocusZone, type PosSaleStep } from '@/components/pos/interactions/pos-interaction-context';
import type { PosFocusManager } from '@/components/pos/interactions/use-pos-focus-manager';

export interface PosProductNavigationOptions<TProduct> {
  enabled: boolean;
  rtl: boolean;
  step: PosSaleStep;
  dialogOpen: boolean;
  activeZone: PosFocusZone;
  products: TProduct[];
  getProductElement: (index: number) => HTMLElement | null;
  onSelectIndex: (index: number) => void;
  selectedIndex: number | null;
  onAddProduct: (product: TProduct) => void;
  onEnterCartZone: () => void;
  focusManager: Pick<PosFocusManager, 'focusZone'>;
}

export function usePosProductNavigation<TProduct>({
  enabled,
  rtl,
  step,
  dialogOpen,
  activeZone,
  products,
  getProductElement,
  onSelectIndex,
  selectedIndex,
  onAddProduct,
  onEnterCartZone,
  focusManager,
}: PosProductNavigationOptions<TProduct>): void {
  const optionsRef = useRef({
    enabled,
    rtl,
    step,
    dialogOpen,
    activeZone,
    products,
    getProductElement,
    onSelectIndex,
    selectedIndex,
    onAddProduct,
    onEnterCartZone,
    focusManager,
  });
  optionsRef.current = {
    enabled,
    rtl,
    step,
    dialogOpen,
    activeZone,
    products,
    getProductElement,
    onSelectIndex,
    selectedIndex,
    onAddProduct,
    onEnterCartZone,
    focusManager,
  };

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const opts = optionsRef.current;
      if (!opts.enabled) return;
      if (isPosSaleInteractionBlocked({ step: opts.step, dialogOpen: opts.dialogOpen })) return;
      if (opts.activeZone !== 'products') return;
      if (opts.products.length === 0) return;

      const arrowDirections: Record<string, GridDirection> = {
        ArrowUp: 'up',
        ArrowDown: 'down',
        ArrowLeft: 'left',
        ArrowRight: 'right',
      };
      const direction = arrowDirections[event.key];
      if (direction) {
        event.preventDefault();
        const rects = opts.products.map((_, index) => {
          const element = opts.getProductElement(index);
          if (!element) return { left: 0, top: 0, width: 0, height: 0 };
          const rect = element.getBoundingClientRect();
          return { left: rect.left, top: rect.top, width: rect.width, height: rect.height };
        });
        const current = opts.selectedIndex ?? 0;
        const next = findGridNeighborIndex(rects, current, direction, opts.rtl);
        if (next !== null) {
          opts.onSelectIndex(next);
          opts.focusManager.focusZone('products', { productIndex: next });
          return;
        }
        if ((direction === 'left' || direction === 'right') && isHorizontalGridEdge(rects, current, direction, opts.rtl)) {
          opts.onEnterCartZone();
        }
        return;
      }

      if (event.key === 'Enter' && opts.selectedIndex !== null) {
        const product = opts.products[opts.selectedIndex];
        if (product) {
          event.preventDefault();
          opts.onAddProduct(product);
        }
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

/** معالجات حقل البحث: ArrowDown → أول منتج، Esc → blur دون مسح النص. */
export function usePosSearchFieldNavigation(options: {
  onMoveToProducts: () => void;
  onExitSearch: () => void;
}) {
  const optionsRef = useRef(options);
  optionsRef.current = options;

  return useCallback((event: React.KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      optionsRef.current.onMoveToProducts();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      event.currentTarget.blur();
      optionsRef.current.onExitSearch();
    }
  }, []);
}

export function usePosProductSelection(productCount: number) {
  const [selectedIndex, setSelectedIndex] = useState<number | null>(null);

  useEffect(() => {
    if (productCount === 0) {
      setSelectedIndex(null);
      return;
    }
    setSelectedIndex((current) => {
      if (current === null || current >= productCount) return 0;
      return current;
    });
  }, [productCount]);

  return { selectedIndex, setSelectedIndex };
}
