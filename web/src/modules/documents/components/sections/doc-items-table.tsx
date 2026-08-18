'use client';

import { useTranslations } from 'next-intl';
import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';
import { DEFAULT_DOCUMENT_ITEMS_COLUMNS } from '@/modules/documents/registry/document-types';
import type { DocBlockAlignment, DocItemsColumn, DocItemsColumnId, DocumentModel, TemplateStyle } from '../../types';
import { useDocStyle } from '../doc-style-context';
import { blockTextClassName, useDocBlockProperties } from '../doc-block-properties-context';

const DEFAULT_COLUMNS: readonly DocItemsColumn[] = DEFAULT_DOCUMENT_ITEMS_COLUMNS.map((id) => ({ id }));

/**
 * الخط الأحادي مخصص للأرقام والأكواد القابلة للمقارنة فقط. لا يُطبّق على
 * اسم المنتج أو وصفه؛ فقد يَسقط الخط الاحتياطي في تشكل عربي متباعد عند التصدير.
 */
const MONOSPACE_VALUE_COLUMNS = new Set<DocItemsColumnId>([
  'number',
  'product_code',
  'barcode',
  'quantity',
  'price_before_tax',
  'unit_price',
  'tax',
  'total',
]);

export function usesMonospaceValue(column: DocItemsColumnId): boolean {
  return MONOSPACE_VALUE_COLUMNS.has(column);
}

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
  return column === 'product' || column === 'description' || column === 'product_code' || column === 'barcode' || column === 'number' ? 'start' : 'end';
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
    product: t('product'),
    description: t('description'),
    product_code: t('product_code'),
    barcode: t('barcode'),
    quantity: t('qty'),
    price_before_tax: t('price_before_tax'),
    unit_price: t('unit_price'),
    tax: t('tax'),
    total: t('total'),
  };

  const valueFor = (column: DocItemsColumnId, line: DocumentModel['lines'][number], index: number): string | number => {
    switch (column) {
      case 'number': return index + 1;
      case 'product': return line.productName || '—';
      case 'description': return line.description || '—';
      case 'product_code': return line.productCode || '—';
      case 'barcode': return line.barcode || '—';
      case 'quantity': return line.quantity;
      case 'price_before_tax': return line.priceBeforeTax === null || line.priceBeforeTax === undefined ? '—' : formatMoney(line.priceBeforeTax);
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
                    usesMonospaceValue(column.id) && 'num',
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
