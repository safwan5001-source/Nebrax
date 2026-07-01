'use client';

import { useTranslations } from 'next-intl';

/** شريط اختصارات لوحة المفاتيح السفلي (ديسكتوب) — ألوان دلالية للحذف/الدرج. */
export function PosShortcuts() {
  const t = useTranslations('pos');
  const keys: { k: string; label: string; tone?: 'danger' | 'positive' }[] = [
    { k: 'F2', label: t('sc_new_customer') },
    { k: 'F4', label: t('sc_search') },
    { k: 'F5', label: t('sc_price') },
    { k: 'F6', label: t('sc_discount') },
    { k: 'F7', label: t('sc_qty') },
    { k: 'F8', label: t('sc_delete'), tone: 'danger' },
    { k: 'Ctrl+D', label: t('sc_drawer'), tone: 'positive' },
  ];
  return (
    <footer className="hidden h-11 shrink-0 items-center gap-1.5 overflow-x-auto border-t border-border bg-surface px-4 lg:flex">
      {keys.map((s) => (
        <div
          key={s.k}
          className={
            'flex items-center gap-1.5 whitespace-nowrap border-e border-border px-2.5 text-[11.5px] last:border-0 ' +
            (s.tone === 'danger' ? 'text-negative' : s.tone === 'positive' ? 'text-positive' : 'text-muted')
          }
        >
          <kbd className="num rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-bold text-text">{s.k}</kbd>
          {s.label}
        </div>
      ))}
    </footer>
  );
}
