'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { isPosEditableTarget } from '@/components/pos/interactions/editable-target';
import { isPosSaleInteractionBlocked, type PosFocusZone, type PosSaleStep } from '@/components/pos/interactions/pos-interaction-context';
import type { PosFocusManager } from '@/components/pos/interactions/use-pos-focus-manager';

export interface PosCartLineRef {
  key: string;
}

export interface PosCartNavigationOptions {
  enabled: boolean;
  step: PosSaleStep;
  dialogOpen: boolean;
  activeZone: PosFocusZone;
  lines: PosCartLineRef[];
  selectedLineKey: string | null;
  onSelectLineKey: (key: string | null) => void;
  onAdjustQty: (lineKey: string, delta: number) => void;
  onRemoveLine: (lineKey: string) => void;
  onEnterProductsZone: () => void;
  focusManager: Pick<PosFocusManager, 'focusZone'>;
}

export function usePosCartNavigation({
  enabled,
  step,
  dialogOpen,
  activeZone,
  lines,
  selectedLineKey,
  onSelectLineKey,
  onAdjustQty,
  onRemoveLine,
  onEnterProductsZone,
  focusManager,
}: PosCartNavigationOptions): void {
  const optionsRef = useRef({
    enabled,
    step,
    dialogOpen,
    activeZone,
    lines,
    selectedLineKey,
    onSelectLineKey,
    onAdjustQty,
    onRemoveLine,
    onEnterProductsZone,
    focusManager,
  });
  optionsRef.current = {
    enabled,
    step,
    dialogOpen,
    activeZone,
    lines,
    selectedLineKey,
    onSelectLineKey,
    onAdjustQty,
    onRemoveLine,
    onEnterProductsZone,
    focusManager,
  };

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      const opts = optionsRef.current;
      if (!opts.enabled) return;
      if (isPosSaleInteractionBlocked({ step: opts.step, dialogOpen: opts.dialogOpen })) return;
      if (opts.activeZone !== 'cart') return;
      if (opts.lines.length === 0) return;
      if (isPosEditableTarget(document.activeElement)) return;

      const keys = opts.lines.map((line) => line.key);
      const currentIndex = opts.selectedLineKey ? keys.indexOf(opts.selectedLineKey) : keys.length - 1;

      if (event.key === 'ArrowDown') {
        event.preventDefault();
        const next = Math.min(keys.length - 1, Math.max(0, currentIndex + 1));
        opts.onSelectLineKey(keys[next]);
        opts.focusManager.focusZone('cart', { cartLineKey: keys[next] });
        return;
      }
      if (event.key === 'ArrowUp') {
        event.preventDefault();
        const next = Math.max(0, currentIndex - 1);
        opts.onSelectLineKey(keys[next]);
        opts.focusManager.focusZone('cart', { cartLineKey: keys[next] });
        return;
      }
      if (event.key === '+' || event.key === '=') {
        event.preventDefault();
        const key = opts.selectedLineKey ?? keys[keys.length - 1];
        if (key) opts.onAdjustQty(key, 1);
        return;
      }
      if (event.key === '-' || event.key === '_') {
        event.preventDefault();
        const key = opts.selectedLineKey ?? keys[keys.length - 1];
        if (key) opts.onAdjustQty(key, -1);
        return;
      }
      if (event.key === 'Delete') {
        event.preventDefault();
        const key = opts.selectedLineKey ?? keys[keys.length - 1];
        if (key) opts.onRemoveLine(key);
        return;
      }
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
        if (currentIndex === 0 && event.key === 'ArrowLeft') {
          event.preventDefault();
          opts.onEnterProductsZone();
        }
        if (currentIndex === keys.length - 1 && event.key === 'ArrowRight') {
          event.preventDefault();
          opts.onEnterProductsZone();
        }
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, []);
}

/** يختار آخر سطر تلقائياً عند تغيّر السلة ما لم يكن هناك اختيار — دون سرقة focus من الماسح. */
export function usePosCartLineSelection(lines: PosCartLineRef[], switchZoneToCart: boolean) {
  const [selectedLineKey, setSelectedLineKey] = useState<string | null>(null);

  useEffect(() => {
    if (lines.length === 0) {
      setSelectedLineKey(null);
      return;
    }
    setSelectedLineKey((current) => {
      if (current && lines.some((line) => line.key === current)) return current;
      if (switchZoneToCart) return lines[lines.length - 1]?.key ?? null;
      return current ?? lines[lines.length - 1]?.key ?? null;
    });
  }, [lines, switchZoneToCart]);

  return { selectedLineKey, setSelectedLineKey };
}
