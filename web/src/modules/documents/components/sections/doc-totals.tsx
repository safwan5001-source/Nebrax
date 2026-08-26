'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { DocumentModel } from '../../types';
import { useDocStyle } from '../doc-style-context';

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

  const isErp = style.composition === 'erp';
  const isModern = style.composition === 'modern';
  const isMinimal = style.composition === 'minimal';
  const baseRow = cn(
    'flex items-baseline justify-between gap-5 px-3 py-1.5',
    isErp ? 'border-t border-[color:var(--border)] text-black' : 'border-t border-[color:var(--border)] text-[color:var(--muted)]',
    isMinimal && 'px-0 py-2 text-black',
  );

  const outer = cn(
    'max-w-[300px] overflow-hidden',
    isModern ? 'w-full' : 'w-[46%]',
    isErp && 'border border-black',
    isModern && 'rounded-md border border-[color:var(--border)] bg-white',
    isMinimal && 'border-y border-black',
    !isErp && !isModern && !isMinimal && 'rounded-lg border border-gray-200',
  );

  const totalRow = cn(
    'flex items-baseline justify-between gap-5 px-3 py-2.5 font-bold',
    isErp && 'border-t-2 border-black',
    isModern && 'border-t-2 border-[color:var(--doc-brand)]',
    isMinimal && 'border-t-2 border-black px-0',
  );
  const totalStyle = isMinimal
    ? undefined
    : isModern
      ? { background: 'var(--doc-brand-soft)', color: 'var(--doc-brand)' }
      : { background: 'var(--doc-brand)', color: 'var(--doc-brand-contrast)' };

  return (
    <div className={outer}>
      <div className={cn('flex items-baseline justify-between gap-5 px-3 py-1.5', isErp || isMinimal ? 'text-black' : 'text-[color:var(--muted)]', isMinimal && 'px-0 py-2')}>
        <span>{t('subtotal')}</span>
        <span className="num">{formatMoney(totals.subtotal)}</span>
      </div>
      {totals.discount && totals.discount > 0 ? (
        <div className={baseRow}>
          <span>{tp('discount')}</span>
          <span className="num">− {formatMoney(totals.discount)}</span>
        </div>
      ) : null}
      {totals.shipping && totals.shipping > 0 ? (
        <div className={baseRow}>
          <span>{tp('shipping')}</span>
          <span className="num">{formatMoney(totals.shipping)}</span>
        </div>
      ) : null}
      {totals.adjustment ? (
        <div className={baseRow}>
          <span>{tp('adjustment')}</span>
          <span className="num">{totals.adjustment < 0 ? '− ' : ''}{formatMoney(Math.abs(totals.adjustment))}</span>
        </div>
      ) : null}
      <div className={baseRow}>
        <span>{t('vat')}</span>
        <span className="num">{formatMoney(totals.tax)}</span>
      </div>
      <div className={totalRow} style={totalStyle}>
        <span>{t('grand_total')}</span>
        <span className="num text-base">{formatMoney(totals.total)}</span>
      </div>
    </div>
  );
}
