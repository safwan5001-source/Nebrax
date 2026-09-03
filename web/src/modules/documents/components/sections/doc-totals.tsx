'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { DocumentModel } from '../../types';
import { useDocStyle } from '../doc-style-context';
import { VISUAL_V2, formatModernMoney } from '../../presentation/visual-v2';
import { ERP_V2 } from '../../presentation/erp-v2';
import { CLASSIC_V2 } from '../../presentation/classic-v2';
import { MINIMAL_V2 } from '../../presentation/minimal-v2';
import { RETAIL_V2 } from '../../presentation/retail-v2';
import { QUOTATION_PROPOSAL } from '../../presentation/quotation-proposal';
import { useDocumentLabelMode } from '../../presentation/use-document-label-mode';
import { ModernTotalLabel } from '../../presentation/modern-bilingual-label';

/** كتلة الإجماليات — تعرض القيم المشتقة كما تصل من نموذج المستند فقط. */
export function DocTotals({
  model,
  formatMoney,
}: {
  model: DocumentModel;
  formatMoney: (minor: number) => string;
}) {
  const t = useTranslations('invoiceDoc');
  const tp = useTranslations('purchaseForm');
  const style = useDocStyle();
  const { totals } = model;
  const { mode } = useDocumentLabelMode(model);
  const isErp = style.composition === 'erp';
  const isErpV2 = style.composition === 'erp_v2';
  const isClassicV2 = style.composition === 'classic_v2';
  const isModernV2 = style.composition === 'modern_v2';
  const isLegacyModern = style.composition === 'modern';
  const isMinimal = style.composition === 'minimal';
  const isMinimalV2 = style.composition === 'minimal_v2';
  const isRetailV2 = style.composition === 'retail_v2';
  const isQuotationProposal = style.composition === 'quotation_proposal';
  const usesV2Labels = isModernV2 || isErpV2 || isClassicV2 || isMinimalV2 || isRetailV2 || isQuotationProposal;
  const displayMoney = usesV2Labels
    ? (minor: number) => formatModernMoney(minor, model.currency, mode)
    : formatMoney;
  const totalLabel = (key: 'subtotal' | 'discount' | 'shipping' | 'adjustment' | 'vat' | 'grand_total') => {
    if (usesV2Labels) return <ModernTotalLabel field={key} mode={mode} />;
    if (key === 'discount' || key === 'shipping' || key === 'adjustment') return tp(key);
    return t(key);
  };

  const baseRow = cn(
    'flex items-baseline justify-between gap-5 px-3 py-1.5',
    isErp ? 'border-t border-[color:var(--border)] text-black' : 'border-t border-[color:var(--border)] text-[color:var(--muted)]',
    isMinimal && 'px-0 py-2 text-black',
    isModernV2 && 'items-start px-0 py-1.5 text-black',
    isErpV2 && 'items-start px-0 py-1 text-black text-[10px]',
    isClassicV2 && 'items-start px-0 py-1.5 text-black text-[11px]',
    isMinimalV2 && 'items-start px-0 py-2 text-black text-[11px]',
    isRetailV2 && 'items-start px-0 py-1 text-black text-[11px]',
    isQuotationProposal && 'items-start px-0 py-1.5 text-black text-[11px]',
  );

  const outer = cn(
    isModernV2 ? VISUAL_V2.totalsMaxClass : isErpV2 ? ERP_V2.totalsMaxClass : isClassicV2 ? CLASSIC_V2.totalsMaxClass : isMinimalV2 ? MINIMAL_V2.totalsMaxClass : isRetailV2 ? RETAIL_V2.totalsMaxClass : isQuotationProposal ? QUOTATION_PROPOSAL.totalsMaxClass : 'max-w-[300px]',
    !usesV2Labels && 'overflow-hidden',
    isModernV2 || isLegacyModern || isErpV2 || isClassicV2 || isMinimalV2 || isRetailV2 || isQuotationProposal ? 'w-full' : 'w-[46%]',
    isErp && 'border border-black',
    isModernV2 && 'border-y border-[color:var(--border)]',
    isErpV2 && 'border-s-2 border-black ps-3',
    isClassicV2 && 'border-y border-black',
    isMinimalV2 && 'border-y border-[color:var(--border)]',
    isRetailV2 && 'border-y border-[color:var(--border)]',
    isQuotationProposal && 'border-y border-[color:var(--border)]',
    isLegacyModern && 'rounded-md border border-[color:var(--border)] bg-white',
    isMinimal && 'border-y border-black',
    !isErp && !isModernV2 && !isErpV2 && !isClassicV2 && !isMinimalV2 && !isRetailV2 && !isQuotationProposal && !isLegacyModern && !isMinimal && 'rounded-lg border border-gray-200',
  );

  const totalRow = cn(
    'flex items-baseline justify-between gap-5 px-3 py-2.5 font-bold',
    isErp && 'border-t-2 border-black',
    isModernV2 && 'items-start border-t border-[color:var(--doc-brand)] px-0 py-2 text-black',
    isErpV2 && 'items-start border-t-2 border-black px-0 py-1.5 text-black text-[12px]',
    isClassicV2 && 'items-start border-t-2 border-b border-black px-0 py-2 text-black text-[13px]',
    isMinimalV2 && 'items-start border-t border-[color:var(--border)] px-0 py-2.5 text-black text-[15px] font-semibold',
    isRetailV2 && 'items-start border-t-2 border-[color:var(--border)] px-0 py-2 text-black text-[14px] font-bold',
    isQuotationProposal && 'items-start border-t-2 border-[color:var(--border)] px-0 py-2 text-black text-[13px] font-semibold',
    isLegacyModern && 'border-t-2 border-[color:var(--doc-brand)]',
    isMinimal && 'border-t-2 border-black px-0',
  );
  const totalStyle = isMinimal || isModernV2 || isErpV2 || isClassicV2 || isMinimalV2 || isRetailV2 || isQuotationProposal
    ? undefined
    : isLegacyModern
      ? { background: 'var(--doc-brand-soft)', color: 'var(--doc-brand)' }
      : { background: 'var(--doc-brand)', color: 'var(--doc-brand-contrast)' };

  const showTaxRow = !isQuotationProposal || (totals.tax != null && totals.tax > 0);

  return (
    <div className={outer} data-doc-totals={style.composition}>
      <div className={cn('flex items-baseline justify-between gap-5 px-3 py-1.5', isErp || isMinimal || isModernV2 || isErpV2 || isClassicV2 || isMinimalV2 || isRetailV2 || isQuotationProposal ? 'text-black' : 'text-[color:var(--muted)]', (isMinimal || isModernV2 || isMinimalV2) && 'px-0 py-2', isModernV2 && 'items-start', isErpV2 && 'items-start px-0 py-1 text-[10px]', isClassicV2 && 'items-start px-0 py-1.5 text-[11px]', isMinimalV2 && 'items-start', isRetailV2 && 'items-start px-0 py-1', isQuotationProposal && 'items-start px-0 py-1.5 text-[11px]')}>
        <span>{totalLabel('subtotal')}</span>
        <span className="num shrink-0" dir="ltr">{displayMoney(totals.subtotal)}</span>
      </div>
      {totals.discount && totals.discount > 0 ? (
        <div className={baseRow}>
          <span>{totalLabel('discount')}</span>
          <span className="num shrink-0" dir="ltr">− {displayMoney(totals.discount)}</span>
        </div>
      ) : null}
      {totals.shipping && totals.shipping > 0 ? (
        <div className={baseRow}>
          <span>{totalLabel('shipping')}</span>
          <span className="num shrink-0" dir="ltr">{displayMoney(totals.shipping)}</span>
        </div>
      ) : null}
      {totals.adjustment ? (
        <div className={baseRow}>
          <span>{totalLabel('adjustment')}</span>
          <span className="num shrink-0" dir="ltr">{totals.adjustment < 0 ? '− ' : ''}{displayMoney(Math.abs(totals.adjustment))}</span>
        </div>
      ) : null}
      {showTaxRow ? (
        <div className={baseRow}>
          <span>{totalLabel('vat')}</span>
          <span className="num shrink-0" dir="ltr">{displayMoney(totals.tax)}</span>
        </div>
      ) : null}
      <div className={totalRow} style={totalStyle}>
        <span>{totalLabel('grand_total')}</span>
        <span className="num shrink-0 text-base" dir="ltr">{displayMoney(totals.total)}</span>
      </div>
    </div>
  );
}
