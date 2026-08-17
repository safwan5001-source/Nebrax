'use client';

import { useTranslations } from 'next-intl';
import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';
import type { DocBlockAlignment, DocItemsColumn, DocItemsColumnId, DocumentModel, TemplateStyle } from '../../types';
import { useDocStyle } from '../doc-style-context';
import { blockTextClassName, useDocBlockProperties } from '../doc-block-properties-context';

const DEFAULT_COLUMNS: readonly DocItemsColumn[] = [
  { id: 'number' },
  { id: 'description' },
  { id: 'quantity' },
  { id: 'unit_price' },
  { id: 'tax' },
  { id: 'total' },
];

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

function textAlignmentClass(alignment: DocBlockAlignment): string {
  return { start: 'text-start', center: 'text-center', end: 'text-end' }[alignment];
}

function defaultAlignment(column: DocItemsColumnId): DocBlockAlignment {
  return column === 'description' || column === 'number' ? 'start' : 'end';
}

/** جدول البنود — أعمدة معتمدة قابلة للترتيب والإخفاء والتسمية والمحاذاة. */
export function DocItemsTable({
  model,
  formatMoney,
}: {
  model: DocumentModel;
  formatMoney: (minor: number) => string;
}) {
  const t = useTranslations('invoiceDoc');
  const style = useDocStyle();
  const properties = useDocBlockProperties('items');
  const head = headRow(style);
  const columns = properties.columns ?? DEFAULT_COLUMNS;
  const labels: Record<DocItemsColumnId, string> = {
    number: '#',
    description: t('description'),
    quantity: t('qty'),
    unit_price: t('unit_price'),
    tax: t('tax'),
    total: t('total'),
  };

  const valueFor = (column: DocItemsColumnId, line: DocumentModel['lines'][number], index: number): string | number => {
    switch (column) {
      case 'number': return index + 1;
      case 'description': return line.description || '—';
      case 'quantity': return line.quantity;
      case 'unit_price': return formatMoney(line.unitPrice);
      case 'tax': return formatMoney(line.tax);
      case 'total': return formatMoney(line.total);
    }
  };

  return (
    <table className={blockTextClassName(properties, cn('w-full border-collapse text-[11px]', style.sectionGap))}>
      <thead>
        <tr className={head.className} style={head.style}>
          {columns.map((column) => {
            const alignment = column.alignment ?? properties.alignment ?? defaultAlignment(column.id);
            return <th key={column.id} className={cn('p-2 font-semibold', textAlignmentClass(alignment))}>{column.label?.trim() || labels[column.id]}</th>;
          })}
        </tr>
      </thead>
      <tbody>
        {model.lines.map((line, index) => (
          <tr key={line.id} className={index % 2 ? 'bg-gray-50' : ''}>
            {columns.map((column) => {
              const alignment = column.alignment ?? properties.alignment ?? defaultAlignment(column.id);
              return (
                <td
                  key={column.id}
                  className={cn(
                    'border-b border-gray-200 p-2',
                    textAlignmentClass(alignment),
                    column.id !== 'description' && 'num',
                    column.id === 'number' && 'text-gray-500',
                    column.id === 'total' && 'font-medium',
                  )}
                >
                  {valueFor(column.id, line, index)}
                </td>
              );
            })}
          </tr>
        ))}
      </tbody>
    </table>
  );
}
