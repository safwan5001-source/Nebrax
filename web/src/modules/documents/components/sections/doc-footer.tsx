'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { DocumentModel } from '../../types';
import { blockTextClassName, useDocBlockProperties } from '../doc-block-properties-context';

/** تذييل المستند — يُدفع لأسفل الصفحة (mt-auto داخل غلاف flex-col). */
export function DocFooter({ model }: { model: DocumentModel }) {
  const t = useTranslations('invoiceDoc');
  const properties = useDocBlockProperties('footer');
  const content = properties.static_content ?? model.footerText ?? t('footer');
  return (
    <div className="mt-auto pt-6">
      <div className={cn('rounded-lg bg-gray-50 p-3 text-[10px] text-center text-gray-500', blockTextClassName(properties))}>
        {content}
      </div>
    </div>
  );
}
