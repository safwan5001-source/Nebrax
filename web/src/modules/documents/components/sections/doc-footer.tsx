'use client';

import { useTranslations } from 'next-intl';
import type { DocumentModel } from '../../types';

/** تذييل المستند — يُدفع لأسفل الصفحة (mt-auto داخل غلاف flex-col). */
export function DocFooter({ model }: { model: DocumentModel }) {
  const t = useTranslations('invoiceDoc');
  return (
    <div className="mt-auto pt-6">
      <div className="rounded-lg bg-gray-50 p-3 text-center text-[10px] text-gray-500">
        {model.footerText ?? t('footer')}
      </div>
    </div>
  );
}
