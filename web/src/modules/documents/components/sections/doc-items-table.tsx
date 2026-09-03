'use client';

import { useTranslations } from 'next-intl';
import type { CSSProperties, ReactNode } from 'react';
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
import {
  ERP_V2_ITEMS_HEAD_CLASS,
  ERP_V2_ITEMS_ROW_CLASS,
  ERP_V2_ITEMS_TABLE_CLASS,
  erpItemsCellPadding,
  erpItemsColumnWidthClass,
  erpItemsValueCellClass,
} from '../../presentation/erp-v2';
import {
  CLASSIC_V2_ITEMS_HEAD_CLASS,
  CLASSIC_V2_ITEMS_ROW_CLASS,
  CLASSIC_V2_ITEMS_TABLE_CLASS,
  classicItemsCellPadding,
  classicItemsColumnWidthClass,
  classicItemsValueCellClass,
} from '../../presentation/classic-v2';
import {
  MINIMAL_V2_ITEMS_HEAD_CLASS,
  MINIMAL_V2_ITEMS_ROW_CLASS,
  MINIMAL_V2_ITEMS_TABLE_CLASS,
  minimalItemsCellPadding,
  minimalItemsColumnWidthClass,
  minimalItemsValueCellClass,
} from '../../presentation/minimal-v2';
import {
  RETAIL_V2_ITEMS_HEAD_CLASS,
  RETAIL_V2_ITEMS_ROW_CLASS,
  RETAIL_V2_ITEMS_TABLE_CLASS,
  retailItemsCellPadding,
  retailItemsColumnWidthClass,
  retailItemsValueCellClass,
} from '../../presentation/retail-v2';
import {
  QUOTATION_PROPOSAL_ITEMS_HEAD_CLASS,
  QUOTATION_PROPOSAL_ITEMS_ROW_CLASS,
  QUOTATION_PROPOSAL_ITEMS_TABLE_CLASS,
  quotationItemsCellPadding,
  quotationItemsColumnWidthClass,
  quotationItemsValueCellClass,
} from '../../presentation/quotation-proposal';
import {
  PURCHASE_ORDER_FORMAL_ITEMS_HEAD_CLASS,
  PURCHASE_ORDER_FORMAL_ITEMS_ROW_CLASS,
  PURCHASE_ORDER_FORMAL_ITEMS_TABLE_CLASS,
  purchaseOrderItemsCellPadding,
  purchaseOrderItemsColumnWidthClass,
  purchaseOrderItemsValueCellClass,
} from '../../presentation/purchase-order-formal';
import { ModernColumnHeader } from '../../presentation/modern-bilingual-label';

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
  if (style.composition === 'modern_v2') {
    return { className: MODERN_ITEMS_HEAD_CLASS };
  }
  if (style.composition === 'erp_v2') {
    return { className: ERP_V2_ITEMS_HEAD_CLASS };
  }
  if (style.composition === 'classic_v2') {
    return { className: CLASSIC_V2_ITEMS_HEAD_CLASS };
  }
  if (style.composition === 'minimal_v2') {
    return { className: MINIMAL_V2_ITEMS_HEAD_CLASS };
  }
  if (style.composition === 'retail_v2') {
    return { className: RETAIL_V2_ITEMS_HEAD_CLASS };
  }
  if (style.composition === 'quotation_proposal') {
    return { className: QUOTATION_PROPOSAL_ITEMS_HEAD_CLASS };
  }
  if (style.composition === 'purchase_order_formal') {
    return { className: PURCHASE_ORDER_FORMAL_ITEMS_HEAD_CLASS };
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
    case 'erp_v2': return ERP_V2_ITEMS_TABLE_CLASS;
    case 'classic_v2': return CLASSIC_V2_ITEMS_TABLE_CLASS;
    case 'minimal_v2': return MINIMAL_V2_ITEMS_TABLE_CLASS;
    case 'retail_v2': return RETAIL_V2_ITEMS_TABLE_CLASS;
    case 'quotation_proposal': return QUOTATION_PROPOSAL_ITEMS_TABLE_CLASS;
    case 'purchase_order_formal': return PURCHASE_ORDER_FORMAL_ITEMS_TABLE_CLASS;
    case 'modern_v2': return MODERN_ITEMS_TABLE_CLASS;
    case 'modern': return 'w-full border-collapse text-[11px] leading-relaxed';
    case 'minimal': return 'w-full border-collapse text-[11px] leading-relaxed';
    default: return 'w-full border-collapse text-[11px]';
  }
}

function cellPadding(style: TemplateStyle): { head: string; body: string } {
  if (style.composition === 'modern_v2') {
    return { head: 'px-1.5 py-1.5', body: 'px-1.5 py-1.5' };
  }
  if (style.composition === 'erp_v2') {
    return { head: 'px-1 py-1', body: 'px-1 py-1' };
  }
  if (style.composition === 'classic_v2') {
    return { head: 'px-1.5 py-1.5', body: 'px-1.5 py-1.5' };
  }
  if (style.composition === 'minimal_v2') {
    return { head: 'px-3 py-2.5', body: 'px-3 py-3' };
  }
  if (style.composition === 'retail_v2') {
    return { head: 'px-1.5 py-1', body: 'px-1.5 py-1' };
  }
  if (style.composition === 'quotation_proposal') {
    return { head: 'px-2 py-2', body: 'px-2 py-2' };
  }
  if (style.composition === 'purchase_order_formal') {
    return { head: 'px-1.5 py-1', body: 'px-1.5 py-1' };
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
    case 'erp_v2': return ERP_V2_ITEMS_ROW_CLASS;
    case 'classic_v2': return CLASSIC_V2_ITEMS_ROW_CLASS;
    case 'minimal_v2': return MINIMAL_V2_ITEMS_ROW_CLASS;
    case 'retail_v2': return RETAIL_V2_ITEMS_ROW_CLASS;
    case 'quotation_proposal': return QUOTATION_PROPOSAL_ITEMS_ROW_CLASS;
    case 'purchase_order_formal': return PURCHASE_ORDER_FORMAL_ITEMS_ROW_CLASS;
    case 'modern_v2': return MODERN_ITEMS_ROW_CLASS;
    case 'modern': return index % 2 ? 'border-b border-[color:var(--border)] bg-[color:var(--doc-brand-soft)]/30' : 'border-b border-[color:var(--border)]';
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
  const isModernV2 = style.composition === 'modern_v2';
  const isErpV2 = style.composition === 'erp_v2';
  const isClassicV2 = style.composition === 'classic_v2';
  const isMinimalV2 = style.composition === 'minimal_v2';
  const isRetailV2 = style.composition === 'retail_v2';
  const isQuotationProposal = style.composition === 'quotation_proposal';
  const isPurchaseOrderFormal = style.composition === 'purchase_order_formal';
  const usesV2Labels = isModernV2 || isErpV2 || isClassicV2 || isMinimalV2 || isRetailV2 || isQuotationProposal || isPurchaseOrderFormal;
  const moneyValue = usesV2Labels
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
    return usesV2Labels && isModernMoneyColumn(column.id)
      ? modernMoneyColumnHeader(base, model.currency, mode)
      : base;
  };

  const headerContent = (column: DocItemsColumn): React.ReactNode => {
    const custom = column.label?.trim();
    if (custom) return headerLabel(column);
    if (usesV2Labels) return <ModernColumnHeader column={column.id} mode={mode} currency={model.currency} />;
    return labels[column.id];
  };

  const columnWidthClass = (columnId: DocItemsColumnId) => (
    isPurchaseOrderFormal ? purchaseOrderItemsColumnWidthClass(columnId) : isQuotationProposal ? quotationItemsColumnWidthClass(columnId) : isRetailV2 ? retailItemsColumnWidthClass(columnId) : isMinimalV2 ? minimalItemsColumnWidthClass(columnId) : isClassicV2 ? classicItemsColumnWidthClass(columnId) : isErpV2 ? erpItemsColumnWidthClass(columnId) : isModernV2 ? modernItemsColumnWidthClass(columnId) : undefined
  );
  const valueCellClass = (columnId: DocItemsColumnId) => (
    isPurchaseOrderFormal ? purchaseOrderItemsValueCellClass(columnId) : isQuotationProposal ? quotationItemsValueCellClass(columnId) : isRetailV2 ? retailItemsValueCellClass(columnId) : isMinimalV2 ? minimalItemsValueCellClass(columnId) : isClassicV2 ? classicItemsValueCellClass(columnId) : isErpV2 ? erpItemsValueCellClass(columnId) : isModernV2 ? modernItemsValueCellClass(columnId) : undefined
  );
  const v2Padding = (columnId: DocItemsColumnId) => (
    isPurchaseOrderFormal ? purchaseOrderItemsCellPadding(columnId) : isQuotationProposal ? quotationItemsCellPadding(columnId) : isRetailV2 ? retailItemsCellPadding(columnId) : isMinimalV2 ? minimalItemsCellPadding(columnId) : isClassicV2 ? classicItemsCellPadding(columnId) : isErpV2 ? erpItemsCellPadding(columnId) : modernItemsCellPadding(columnId)
  );

  const table = (
    <table className={blockTextClassName(properties, cn(tableClassName(style), !usesV2Labels && style.sectionGap))}>
      <thead>
        <tr className={head.className} style={head.style}>
          {columns.map((column) => {
            const alignment = column.alignment ?? properties.alignment ?? defaultAlignment(column.id);
            return (
              <th
                key={column.id}
                className={cn(
                  usesV2Labels ? v2Padding(column.id) : padding.head,
                  'font-semibold',
                  textAlignmentClass(alignment),
                  column.id === 'total' && 'font-bold',
                  usesV2Labels && 'whitespace-normal break-words leading-tight',
                  columnWidthClass(column.id),
                )}
              >
                {headerContent(column)}
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
                    usesV2Labels ? v2Padding(column.id) : padding.body,
                    textAlignmentClass(alignment),
                    usesMonospaceValue(column.id) && 'num',
                    column.id === 'number' && 'text-[color:var(--muted)]',
                    column.id === 'total' && 'font-bold',
                    column.id === 'total' && style.composition === 'erp' && 'bg-[color:var(--doc-brand-soft)]',
                    column.id === 'total' && style.composition === 'minimal' && 'border-s-2 border-black',
                    columnWidthClass(column.id),
                    valueCellClass(column.id),
                  )}
                  dir={usesV2Labels && usesMonospaceValue(column.id) ? 'ltr' : undefined}
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

  if (usesV2Labels) {
    return <div className={cn('overflow-hidden', style.sectionGap)}>{table}</div>;
  }

  return table;
}
