'use client';

import { useTranslations } from 'next-intl';
import { POS_SHORTCUT_FOOTER } from '@/components/pos/interactions/shortcut-registry';

/**
 * شريط اختصارات لوحة المفاتيح السفلي (ديسكتوب) — ألوان دلالية للحذف/الدفع.
 * يقرأ الاختصارات من السجل نفسه الذي ينفّذها، فلا يعرض مفتاحاً لا يعمل.
 */
export function PosShortcuts({ visible = true }: { visible?: boolean }) {
  const t = useTranslations('pos');
  return (
    <footer
      data-testid="pos-shortcut-footer"
      data-visible={visible ? 'true' : 'false'}
      className={visible
        ? 'hidden h-11 shrink-0 items-center gap-1.5 overflow-x-auto border-t border-border bg-surface px-4 lg:flex'
        : 'hidden'}
    >
      {POS_SHORTCUT_FOOTER.map((shortcut) => (
        <div
          key={`${shortcut.id}-${shortcut.displayKey}`}
          className={
            'flex items-center gap-1.5 whitespace-nowrap border-e border-border px-2.5 text-[11.5px] last:border-0 ' +
            (shortcut.tone === 'danger' ? 'text-negative' : shortcut.tone === 'positive' ? 'text-positive' : 'text-muted')
          }
        >
          <kbd className="num rounded border border-border bg-background px-1.5 py-0.5 text-[10px] font-bold text-text">{shortcut.displayKey}</kbd>
          {t(shortcut.translationKey)}
        </div>
      ))}
    </footer>
  );
}
