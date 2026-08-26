'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { DocumentModel } from '../../types';
import { useDocStyle } from '../doc-style-context';
import { blockTextClassName, useDocBlockProperties } from '../doc-block-properties-context';

/** الشروط والأحكام — لا يظهر القسم حين لا نصّ. */
export function DocTerms({ model }: { model: DocumentModel }) {
  const t = useTranslations('invoiceDoc');
  const style = useDocStyle();
  const properties = useDocBlockProperties('terms');
  const content = properties.static_content ?? model.terms;
  if (!content || content.trim() === '') return null;

  const frame = style.composition === 'erp'
    ? 'border-t-2 border-black py-3'
    : style.composition === 'modern'
      ? 'rounded-md border border-[color:var(--border)] bg-[color:var(--doc-brand-soft)] p-4'
      : style.composition === 'minimal'
        ? 'border-t border-black py-3'
        : 'rounded-lg bg-gray-50 p-3';

  return (
    <section className={cn(frame, style.sectionGap)}>
      <div className="mb-1 text-[10px] font-bold text-[color:var(--muted)]">{t('terms')}</div>
      <p className={blockTextClassName(properties, 'whitespace-pre-line text-[10px] leading-relaxed text-black')}>{content}</p>
    </section>
  );
}
