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

  return (
    <div className={cn('rounded-lg border border-gray-200 p-3', style.sectionGap)}>
      <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-gray-400">{t('notes')}</div>
      <p className={blockTextClassName(properties, 'whitespace-pre-line text-[11px] text-gray-700')}>{model.notes}</p>
    </div>
  );
}
