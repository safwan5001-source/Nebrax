'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { DocumentModel } from '../../types';
import { useDocStyle } from '../doc-style-context';
import { useDocBlockProperties } from '../doc-block-properties-context';

/** التوقيع — صورة فوق خطّ توقيع. لا يظهر بلا صورة. */
export function DocSignature({ model }: { model: DocumentModel }) {
  const t = useTranslations('invoiceDoc');
  const style = useDocStyle();
  const properties = useDocBlockProperties('signature');
  const itemsAlignment = {
    start: 'items-start',
    center: 'items-center',
    end: 'items-end',
  }[properties.alignment ?? 'start'];
  if (!model.signatureUrl) return null;

  return (
    <div className={cn('flex flex-col', itemsAlignment, style.sectionGap)}>
      {/* eslint-disable-next-line @next/next/no-img-element -- data URL */}
      <img src={model.signatureUrl} alt={t('signature')} className="h-14 w-auto object-contain" />
      <div className="mt-1 w-40 border-t border-gray-400 pt-1 text-[10px] text-gray-500">{t('signature')}</div>
    </div>
  );
}
