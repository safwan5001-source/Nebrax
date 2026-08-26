'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { DocumentModel } from '../../types';
import { useDocStyle } from '../doc-style-context';
import { blockTextClassName, useDocBlockProperties } from '../doc-block-properties-context';

/** ملاحظات المستند — لا يظهر القسم حين لا نصّ. */
export function DocNotes({ model }: { model: DocumentModel }) {
  const t = useTranslations('invoiceDoc');
  const style = useDocStyle();
  const properties = useDocBlockProperties('notes');
  if (!model.notes || model.notes.trim() === '') return null;

  const frame = style.composition === 'erp'
    ? 'border-t border-black py-3'
    : style.composition === 'modern'
      ? 'rounded-md border border-[color:var(--border)] p-4'
      : style.composition === 'minimal'
        ? 'border-t border-black py-3'
        : cn('rounded-lg border border-gray-200 p-3', style.cardRadius);

  return (
    <section className={cn(frame, style.sectionGap)}>
      <div className="mb-1 text-[10px] font-bold text-[color:var(--muted)]">{t('notes')}</div>
      <p className={blockTextClassName(properties, 'whitespace-pre-line text-[11px] text-black')}>{model.notes}</p>
    </section>
  );
}
