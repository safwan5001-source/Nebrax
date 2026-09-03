'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { DocumentModel } from '../../types';
import { useDocStyle } from '../doc-style-context';
import { blockTextClassName, useDocBlockProperties } from '../doc-block-properties-context';
import { useDocumentLabelMode } from '../../presentation/use-document-label-mode';
import { ModernFieldLabel } from '../../presentation/modern-bilingual-label';

/** البيانات البنكية — لا يظهر القسم بلا نصّ. */
export function DocBank({ model }: { model: DocumentModel }) {
  const t = useTranslations('invoiceDoc');
  const style = useDocStyle();
  const properties = useDocBlockProperties('bank');
  const { mode } = useDocumentLabelMode(model);
  const content = properties.static_content ?? model.bank;
  if (!content || content.trim() === '') return null;

  const frame = style.composition === 'erp' || style.composition === 'erp_v2' || style.composition === 'classic_v2'
    ? 'border-y border-black py-3'
    : style.composition === 'modern_v2' || style.composition === 'minimal_v2'
      ? 'border-t border-[color:var(--border)] py-3'
      : style.composition === 'modern'
        ? 'rounded-md border border-[color:var(--border)] p-4'
        : style.composition === 'minimal'
          ? 'border-t border-black py-3'
          : cn('border border-gray-200 p-3', style.cardRadius);
  const title = style.composition === 'modern_v2' || style.composition === 'erp_v2' || style.composition === 'classic_v2' || style.composition === 'minimal_v2' ? <ModernFieldLabel field="bank" mode={mode} /> : t('bank');

  return (
    <section className={cn(frame, style.sectionGap)}>
      <div className="mb-1 text-[10px] font-bold text-[color:var(--muted)]">{title}</div>
      <p className={blockTextClassName(properties, 'whitespace-pre-line break-words text-[11px] text-black')}>{content}</p>
    </section>
  );
}
