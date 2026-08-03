'use client';

import { useTranslations } from 'next-intl';
import type { DocumentModel } from '../../types';

/** كتلة الإجماليات — الإجمالي قبل الضريبة، الضريبة، والإجمالي النهائي بلون الهوية. */
export function DocTotals({
  model,
  formatMoney,
}: {
  model: DocumentModel;
  formatMoney: (minor: number) => string;
}) {
  const t = useTranslations('invoiceDoc');
  const { totals } = model;

  return (
    <div className="w-[46%] max-w-[280px] overflow-hidden rounded-lg border border-gray-200">
      <div className="flex justify-between px-3 py-1.5 text-gray-600">
        <span>{t('subtotal')}</span>
        <span className="num">{formatMoney(totals.subtotal)}</span>
      </div>
      <div className="flex justify-between border-t border-gray-100 px-3 py-1.5 text-gray-600">
        <span>{t('vat')}</span>
        <span className="num">{formatMoney(totals.tax)}</span>
      </div>
      <div
        className="flex items-baseline justify-between px-3 py-2.5 font-bold"
        style={{ background: 'var(--doc-brand)', color: 'var(--doc-brand-contrast)' }}
      >
        <span>{t('grand_total')}</span>
        <span className="num text-base">{formatMoney(totals.total)}</span>
      </div>
    </div>
  );
}
