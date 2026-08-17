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

  return (
    <div className={cn('rounded-lg bg-gray-50 p-3', style.sectionGap)}>
      <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-gray-400">{t('terms')}</div>
      <p className={blockTextClassName(properties, 'whitespace-pre-line text-[10px] leading-relaxed text-gray-600')}>{content}</p>
    </div>
  );
}
