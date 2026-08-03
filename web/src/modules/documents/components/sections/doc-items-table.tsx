'use client';

import { useTranslations } from 'next-intl';
import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';
import type { DocumentModel, TemplateStyle } from '../../types';
import { useDocStyle } from '../doc-style-context';

/** خصائص صفّ رأس الجدول حسب نمط القالب. */
function headRow(style: TemplateStyle): { className: string; style?: CSSProperties } {
  switch (style.tableHead) {
    case 'soft':
      return { className: 'text-black', style: { background: 'var(--doc-brand-soft)' } };
    case 'plain':
      return { className: 'border-b-2 border-gray-300 text-gray-600' };
    case 'brand':
    default:
      return { className: '', style: { background: 'var(--doc-brand)', color: 'var(--doc-brand-contrast)' } };
  }
}

/** جدول البنود — رأس حسب النمط، ترقيم وصفوف متناوبة، أرقام بمحاذاة النهاية. */
export function DocItemsTable({
  model,
  formatMoney,
}: {
  model: DocumentModel;
  formatMoney: (minor: number) => string;
}) {
  const t = useTranslations('invoiceDoc');
  const style = useDocStyle();
  const head = headRow(style);

  return (
    <table className={cn('w-full border-collapse text-[11px]', style.sectionGap)}>
      <thead>
        <tr className={head.className} style={head.style}>
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
