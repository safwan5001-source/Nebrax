'use client';

import { useRef } from 'react';
import { cn } from '@/lib/utils';

export interface TabDef {
  id: string;
  label: string;
  /** عدّاد اختياري يظهر بجانب العنوان (بخط الأرقام). */
  count?: number;
}

/**
 * تبويبات أفقية — نمط WAI-ARIA: `tablist` بتنقّل بالأسهم و`Home`/`End`،
 * والتبويب النشط وحده في ترتيب الـ Tab (roving tabindex).
 * الاتجاه RTL: السهم الأيمن يتقدّم للخلف بصرياً، فالمنطق على الترتيب لا الاتجاه.
 */
export function Tabs({
  tabs,
  value,
  onChange,
  className,
}: {
  tabs: TabDef[];
  value: string;
  onChange: (id: string) => void;
  className?: string;
}) {
  const listRef = useRef<HTMLDivElement>(null);

  function onKeyDown(e: React.KeyboardEvent) {
    const i = tabs.findIndex((t) => t.id === value);
    if (i < 0) return;

    // في RTL يعكس المتصفّح معنى السهمين بصرياً — نتبع الترتيب المنطقي للقائمة.
    const rtl = document.documentElement.dir === 'rtl';
    const next = { ArrowRight: rtl ? -1 : 1, ArrowLeft: rtl ? 1 : -1 }[e.key];

    let target: number | null = null;
    if (next !== undefined) target = (i + next + tabs.length) % tabs.length;
    if (e.key === 'Home') target = 0;
    if (e.key === 'End') target = tabs.length - 1;
    if (target === null) return;

    e.preventDefault();
    onChange(tabs[target].id);
    listRef.current?.querySelectorAll<HTMLButtonElement>('[role="tab"]')[target]?.focus();
  }

  return (
    <div
      ref={listRef}
      role="tablist"
      onKeyDown={onKeyDown}
      className={cn('flex gap-1 overflow-x-auto border-b border-border px-2', className)}
    >
      {tabs.map((t) => {
        const on = t.id === value;
        return (
          <button
            key={t.id}
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={on}
            aria-controls={`panel-${t.id}`}
            tabIndex={on ? 0 : -1}
            onClick={() => onChange(t.id)}
            className={cn(
              'whitespace-nowrap border-b-2 px-3.5 py-3 text-sm font-medium transition-colors',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
              on
                ? 'border-primary text-primary'
                : 'border-transparent text-muted hover:text-text'
            )}
          >
            {t.label}
            {t.count !== undefined && <span className="num ms-1.5 text-xs">{t.count}</span>}
          </button>
        );
      })}
    </div>
  );
}

/** لوحة تبويب — تُربط بزرّها عبر `aria-labelledby` ولا تُركَّب إلا وهي نشطة. */
export function TabPanel({ id, children }: { id: string; children: React.ReactNode }) {
  return (
    <div role="tabpanel" id={`panel-${id}`} aria-labelledby={`tab-${id}`} tabIndex={0}>
      {children}
    </div>
  );
}
