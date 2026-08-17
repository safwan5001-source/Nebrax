'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { DocumentModel } from '../../types';
import { useDocStyle } from '../doc-style-context';
import { blockTextClassName, useDocBlockProperties } from '../doc-block-properties-context';

/** البيانات البنكية — لا يظهر القسم بلا نصّ. */
export function DocBank({ model }: { model: DocumentModel }) {
  const t = useTranslations('invoiceDoc');
  const style = useDocStyle();
  const properties = useDocBlockProperties('bank');
  const content = properties.static_content ?? model.bank;
  if (!content || content.trim() === '') return null;

  return (
    <div className={cn('border border-gray-200 p-3', style.cardRadius, style.sectionGap)}>
      <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-gray-400">{t('bank')}</div>
      <p className={blockTextClassName(properties, 'whitespace-pre-line text-[11px] text-gray-700')}>{content}</p>
    </div>
  );
}
