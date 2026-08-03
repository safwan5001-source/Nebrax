'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { DocumentModel } from '../../types';
import { useDocStyle } from '../doc-style-context';

/** الشروط والأحكام — لا يظهر القسم حين لا نصّ. */
export function DocTerms({ model }: { model: DocumentModel }) {
  const t = useTranslations('invoiceDoc');
  const style = useDocStyle();
  if (!model.terms || model.terms.trim() === '') return null;

  return (
    <div className={cn('rounded-lg bg-gray-50 p-3', style.sectionGap)}>
      <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-gray-400">{t('terms')}</div>
      <p className="whitespace-pre-line text-[10px] leading-relaxed text-gray-600">{model.terms}</p>
    </div>
  );
}
