'use client';

import { useEffect, useMemo, useState } from 'react';
import type { VisibilityState } from '@tanstack/react-table';
import { currentUser } from '@/lib/auth';

const STORAGE_VERSION = 1;

function storageKey(tableKey: string): string {
  let user: ReturnType<typeof currentUser> = null;
  try {
    user = currentUser();
  } catch {
    // تفضيل الواجهة لا يوقف عرض الجدول إن كان التخزين غير متاح.
  }

  return `nibras_data_table_layout_v${STORAGE_VERSION}:${user?.tenant_id ?? 'anonymous'}:${user?.id ?? 'anonymous'}:${tableKey}`;
}

function parseVisibility(value: string | null): VisibilityState | null {
  if (!value) return null;

  try {
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return null;

    const next: VisibilityState = {};
    for (const [columnId, visible] of Object.entries(parsed)) {
      if (typeof visible !== 'boolean') return null;
      next[columnId] = visible;
    }
    return next;
  } catch {
    return null;
  }
}

export interface DataTableColumnVisibilityControl {
  value: VisibilityState;
  onChange: (next: VisibilityState) => void;
  /** أعمدة لا يمكن إخفاؤها، مثل هوية السجل أو عمود الإجراءات. */
  protectedColumnIds?: string[];
  /** تسمية عرض اختيارية للعمود حين لا تكون ترويسة TanStack نصاً بسيطاً. */
  labels?: Record<string, string>;
}

/**
 * يحفظ تفضيل ظهور الأعمدة محلياً ومعزولاً بالمستأجر والمستخدم والجدول.
 * لا يحمل أي أثر على API أو التفويض؛ هو تفضيل عرض فقط.
 */
export function useDataTableColumnVisibility(tableKey: string): DataTableColumnVisibilityControl {
  const [value, setValue] = useState<VisibilityState>({});
  const key = useMemo(() => storageKey(tableKey), [tableKey]);

  useEffect(() => {
    const stored = typeof window === 'undefined' ? null : parseVisibility(safelyRead(key));
    setValue(stored ?? {});
  }, [key]);

  const onChange = (next: VisibilityState) => {
    setValue(next);
    try {
      localStorage.setItem(key, JSON.stringify(next));
    } catch {
      // استمرار التفضيل تحسين واجهة اختياري فقط.
    }
  };

  return { value, onChange };
}

function safelyRead(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function normalizeProtectedColumns(
  visibility: VisibilityState,
  protectedColumnIds: string[] | undefined,
): VisibilityState {
  if (!protectedColumnIds?.length) return visibility;

  const normalized = { ...visibility };
  for (const columnId of protectedColumnIds) {
    delete normalized[columnId];
  }
  return normalized;
}
