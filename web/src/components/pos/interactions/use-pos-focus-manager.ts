'use client';

import { useCallback, useMemo, useRef } from 'react';
import { isPosEditableTarget } from '@/components/pos/interactions/editable-target';

export interface PosFocusManager {
  /** يُمرَّر كـ`ref` لحقل البحث؛ لا يفرض تركيزاً عند التسجيل. */
  registerSearchInput: (element: HTMLInputElement | null) => void;
  /** تركيز صريح بطلب المستخدم (F4 أو زر الباركود) — ينفَّذ دائماً. */
  focusSearch: () => void;
  /**
   * استعادة تركيز آمنة: ترفض السحب من حقل يكتب فيه المستخدم أو من داخل حوار
   * مفتوح. لا تُستدعى تلقائياً اليوم؛ هي الأساس الذي يبني عليه وضع لوحة
   * المفاتيح لاحقاً بلا auto-focus عدواني.
   */
  restoreSearchFocus: () => boolean;
}

export function usePosFocusManager(): PosFocusManager {
  const searchInputRef = useRef<HTMLInputElement | null>(null);

  const registerSearchInput = useCallback((element: HTMLInputElement | null) => {
    searchInputRef.current = element;
  }, []);

  const focusSearch = useCallback(() => {
    searchInputRef.current?.focus();
  }, []);

  const restoreSearchFocus = useCallback(() => {
    const active = document.activeElement;
    if (isPosEditableTarget(active)) return false;
    if (active?.closest('[role="dialog"]')) return false;
    const input = searchInputRef.current;
    if (!input) return false;
    input.focus();
    return true;
  }, []);

  return useMemo(
    () => ({ registerSearchInput, focusSearch, restoreSearchFocus }),
    [focusSearch, registerSearchInput, restoreSearchFocus],
  );
}
