'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { DocumentModel } from '../../types';
import { useDocStyle } from '../doc-style-context';
import { blockTextClassName, useDocBlockProperties } from '../doc-block-properties-context';

/** تذييل المستند — يُدفع لأسفل الصفحة (mt-auto داخل غلاف flex-col). */
export function DocFooter({ model }: { model: DocumentModel }) {
  const t = useTranslations('invoiceDoc');
  const style = useDocStyle();
  const properties = useDocBlockProperties('footer');
  const content = properties.static_content ?? model.footerText ?? t('footer');
  const frame = style.composition === 'erp'
    ? 'border-t border-black pt-3'
    : style.composition === 'modern'
      ? 'border-t border-[color:var(--border)] pt-3'
      : style.composition === 'minimal'
        ? 'border-t border-black pt-3'
        : 'rounded-lg bg-gray-50 p-3';

  return (
    <footer className="mt-auto pt-6">
      <div className={cn(frame, 'text-[10px] text-center text-[color:var(--muted)]', blockTextClassName(properties))}>
        {content}
      </div>
    </footer>
  );
}
