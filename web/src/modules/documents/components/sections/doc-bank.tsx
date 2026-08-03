'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { DocumentModel } from '../../types';
import { useDocStyle } from '../doc-style-context';

/** البيانات البنكية — لا يظهر القسم بلا نصّ. */
export function DocBank({ model }: { model: DocumentModel }) {
  const t = useTranslations('invoiceDoc');
  const style = useDocStyle();
  if (!model.bank || model.bank.trim() === '') return null;

  return (
    <div className={cn('border border-gray-200 p-3', style.cardRadius, style.sectionGap)}>
      <div className="mb-1 text-[10px] font-bold uppercase tracking-wide text-gray-400">{t('bank')}</div>
      <p className="whitespace-pre-line text-[11px] text-gray-700">{model.bank}</p>
    </div>
  );
}
