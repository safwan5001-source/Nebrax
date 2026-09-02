'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { DocumentModel } from '../../types';
import { useDocStyle } from '../doc-style-context';
import { blockTextClassName, useDocBlockProperties } from '../doc-block-properties-context';
import { useDocumentLabelMode } from '../../presentation/use-document-label-mode';
import { modernFieldLabel } from '../../presentation/visual-v2';

/** البيانات البنكية — لا يظهر القسم بلا نصّ. */
export function DocBank({ model }: { model: DocumentModel }) {
  const t = useTranslations('invoiceDoc');
  const style = useDocStyle();
  const properties = useDocBlockProperties('bank');
  const { mode } = useDocumentLabelMode(model);
  const content = properties.static_content ?? model.bank;
  if (!content || content.trim() === '') return null;

  const frame = style.composition === 'erp'
    ? 'border-y border-black py-3'
    : style.composition === 'modern'
      ? 'border-t border-[color:var(--border)] py-3'
      : style.composition === 'minimal'
        ? 'border-t border-black py-3'
        : cn('border border-gray-200 p-3', style.cardRadius);
  const title = style.composition === 'modern' ? modernFieldLabel('bank', mode) : t('bank');

  return (
    <section className={cn(frame, style.sectionGap)}>
      <div className="mb-1 text-[10px] font-bold text-[color:var(--muted)]">{title}</div>
      <p className={blockTextClassName(properties, 'whitespace-pre-line break-words text-[11px] text-black')}>{content}</p>
    </section>
  );
}
