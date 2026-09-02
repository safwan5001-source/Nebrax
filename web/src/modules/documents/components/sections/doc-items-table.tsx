'use client';

import { useTranslations } from 'next-intl';
import type { CSSProperties } from 'react';
import { cn } from '@/lib/utils';
import { getDefaultDocumentItemColumns } from '@/modules/documents/registry/document-types';
import type { DocBlockAlignment, DocItemsColumn, DocItemsColumnId, DocumentModel, TemplateStyle } from '../../types';
import { useDocStyle } from '../doc-style-context';
import { blockTextClassName, useDocBlockProperties } from '../doc-block-properties-context';
import { useDocumentLabelMode } from '../../presentation/use-document-label-mode';
import {
  MODERN_ITEMS_HEAD_CLASS,
  MODERN_ITEMS_ROW_CLASS,
  MODERN_ITEMS_TABLE_CLASS,
  formatModernAmount,
  isModernMoneyColumn,
  modernItemsCellPadding,
  modernItemsColumnWidthClass,
  modernItemsValueCellClass,
  modernMoneyColumnHeader,
} from '../../presentation/visual-v2';

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
  if (style.composition === 'modern') {
    return { className: MODERN_ITEMS_HEAD_CLASS };
  }
  switch (style.tableHead) {
    case 'soft':
      return { className: 'border-y border-[color:var(--border)] text-black', style: { background: 'var(--doc-brand-soft)' } };
    case 'plain':
      return { className: style.composition === 'minimal' ? 'border-y border-black text-black' : 'border-b-2 border-black text-black' };
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

function tableClassName(style: TemplateStyle): string {
  switch (style.composition) {
    case 'erp': return 'w-full border-collapse text-[10px] leading-snug';
    case 'modern': return MODERN_ITEMS_TABLE_CLASS;
    case 'minimal': return 'w-full border-collapse text-[11px] leading-relaxed';
    default: return 'w-full border-collapse text-[11px]';
  }
}

function cellPadding(style: TemplateStyle): { head: string; body: string } {
  if (style.composition === 'modern') {
    return { head: 'px-1.5 py-1.5', body: 'px-1.5 py-1.5' };
  }
  switch (style.tableDensity) {
    case 'compact': return { head: 'px-2 py-1.5', body: 'px-2 py-1.5' };
    case 'spacious': return { head: 'px-3 py-2.5', body: 'px-3 py-3' };
    default: return { head: 'px-3 py-2', body: 'px-3 py-2.5' };
  }
}

function bodyRowClassName(style: TemplateStyle, index: number): string {
  switch (style.composition) {
    case 'erp': return 'border-b border-[color:var(--border)]';
    case 'modern': return MODERN_ITEMS_ROW_CLASS;
    case 'minimal': return 'border-b border-[color:var(--border)]';
    default: return index % 2 ? 'bg-gray-50' : '';
  }
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
  const { mode } = useDocumentLabelMode(model);
  const head = headRow(style);
  const padding = cellPadding(style);
  const columns: readonly DocItemsColumn[] = properties.columns ?? getDefaultDocumentItemColumns(model.type).map((id): DocItemsColumn => ({ id }));
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
  const isModern = style.composition === 'modern';
  const moneyValue = isModern
    ? (minor: number) => formatModernAmount(minor, model.currency)
    : formatMoney;

  const valueFor = (column: DocItemsColumnId, line: DocumentModel['lines'][number], index: number): string | number => {
    switch (column) {
      case 'number': return index + 1;
      case 'product': return line.productName || '—';
      case 'description': return line.description || '—';
      case 'product_code': return line.productCode || '—';
      case 'barcode': return line.barcode || '—';
      case 'quantity': return line.quantity;
      case 'price_before_tax': return line.priceBeforeTax === null || line.priceBeforeTax === undefined ? '—' : moneyValue(line.priceBeforeTax);
      case 'unit_price': return moneyValue(line.unitPrice);
      case 'tax': return moneyValue(line.tax);
      case 'total': return moneyValue(line.total);
    }
  };

  const headerLabel = (column: DocItemsColumn): string => {
    const base = column.label?.trim() || labels[column.id];
    return isModern && isModernMoneyColumn(column.id)
      ? modernMoneyColumnHeader(base, model.currency, mode)
      : base;
  };

  const table = (
    <table className={blockTextClassName(properties, cn(tableClassName(style), !isModern && style.sectionGap))}>
      <thead>
        <tr className={head.className} style={head.style}>
          {columns.map((column) => {
            const alignment = column.alignment ?? properties.alignment ?? defaultAlignment(column.id);
            return (
              <th
                key={column.id}
                className={cn(
                  isModern ? modernItemsCellPadding(column.id) : padding.head,
                  'font-semibold',
                  textAlignmentClass(alignment),
                  column.id === 'total' && 'font-bold',
                  isModern && isModernMoneyColumn(column.id) && 'whitespace-nowrap',
                  isModern && modernItemsColumnWidthClass(column.id),
                )}
              >
                {headerLabel(column)}
              </th>
            );
          })}
        </tr>
      </thead>
      <tbody>
        {model.lines.map((line, index) => (
          <tr key={line.id} className={bodyRowClassName(style, index)}>
            {columns.map((column) => {
              const alignment = column.alignment ?? properties.alignment ?? defaultAlignment(column.id);
              return (
                <td
                  key={column.id}
                  className={cn(
                    isModern ? modernItemsCellPadding(column.id) : padding.body,
                    textAlignmentClass(alignment),
                    usesMonospaceValue(column.id) && 'num',
                    column.id === 'number' && 'text-[color:var(--muted)]',
                    column.id === 'total' && 'font-bold',
                    column.id === 'total' && style.composition === 'erp' && 'bg-[color:var(--doc-brand-soft)]',
                    column.id === 'total' && style.composition === 'minimal' && 'border-s-2 border-black',
                    isModern && modernItemsColumnWidthClass(column.id),
                    isModern && modernItemsValueCellClass(column.id),
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

  if (isModern) {
    return <div className={cn('overflow-hidden', style.sectionGap)}>{table}</div>;
  }

  return table;
}
