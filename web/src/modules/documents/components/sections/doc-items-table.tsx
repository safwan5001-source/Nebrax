'use client';

import { useTranslations } from 'next-intl';
import type { DocumentModel } from '../../types';

/** جدول البنود — رأس بلون الهوية، ترقيم وصفوف متناوبة، أرقام بمحاذاة النهاية. */
export function DocItemsTable({
  model,
  formatMoney,
}: {
  model: DocumentModel;
  formatMoney: (minor: number) => string;
}) {
  const t = useTranslations('invoiceDoc');

  return (
    <table className="mt-5 w-full border-collapse text-[11px]">
      <thead>
        <tr style={{ background: 'var(--doc-brand)', color: 'var(--doc-brand-contrast)' }}>
          <th className="p-2 text-start font-semibold">#</th>
          <th className="p-2 text-start font-semibold">{t('description')}</th>
          <th className="p-2 text-end font-semibold">{t('qty')}</th>
          <th className="p-2 text-end font-semibold">{t('unit_price')}</th>
          <th className="p-2 text-end font-semibold">{t('tax')}</th>
          <th className="p-2 text-end font-semibold">{t('total')}</th>
        </tr>
      </thead>
      <tbody>
        {model.lines.map((line, i) => (
          <tr key={line.id} className={i % 2 ? 'bg-gray-50' : ''}>
            <td className="num border-b border-gray-200 p-2 text-gray-500">{i + 1}</td>
            <td className="border-b border-gray-200 p-2">{line.description || '—'}</td>
            <td className="num border-b border-gray-200 p-2 text-end">{line.quantity}</td>
            <td className="num border-b border-gray-200 p-2 text-end">{formatMoney(line.unitPrice)}</td>
            <td className="num border-b border-gray-200 p-2 text-end">{formatMoney(line.tax)}</td>
            <td className="num border-b border-gray-200 p-2 text-end font-medium">{formatMoney(line.total)}</td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
