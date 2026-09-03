'use client';

import { useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { DocumentModel } from '../../types';
import { useDocStyle } from '../doc-style-context';
import { useDocumentLabelMode } from '../../presentation/use-document-label-mode';
import { ModernFieldLabel } from '../../presentation/modern-bilingual-label';

/**
 * جسم السند (قبض/صرف) — بديل جدول البنود لمستند لا يحمل ضريبة:
 * عبارة الاتجاه + مبلغ بارز + الطريقة/المرجع + قائمة ما غطّاه من مستندات.
 */
export function DocVoucher({
  model,
  formatMoney,
}: {
  model: DocumentModel;
  formatMoney: (minor: number) => string;
}) {
  const t = useTranslations('voucherDoc');
  const style = useDocStyle();
  const { mode } = useDocumentLabelMode(model);
  const v = model.voucher;
  if (!v) return null;

  const isModernV2 = style.composition === 'modern_v2';
  const isErpV2 = style.composition === 'erp_v2';
  const isClassicV2 = style.composition === 'classic_v2';
  const isMinimalV2 = style.composition === 'minimal_v2';
  const isRetailV2 = style.composition === 'retail_v2';
  const isQuotationProposal = style.composition === 'quotation_proposal';
  const isPurchaseOrderFormal = style.composition === 'purchase_order_formal';
  const voucherLabel = (
    key: 'received_from' | 'paid_to' | 'amount' | 'method' | 'reference' | 'applied_to',
  ) => (isModernV2 || isErpV2 || isClassicV2 || isMinimalV2 || isRetailV2 || isQuotationProposal || isPurchaseOrderFormal ? <ModernFieldLabel field={key} mode={mode} /> : t(key));

  const party = model.buyer.name || '—';
  const phrase = v.direction === 'received' ? voucherLabel('received_from') : voucherLabel('paid_to');

  return (
    <div className={cn('space-y-3', style.sectionGap)}>
      {/* المبلغ البارز — البطل البصري للسند. */}
      <div
        className={cn('flex items-center justify-between border p-4', style.cardRadius)}
        style={{ borderColor: 'var(--doc-brand)', background: 'var(--doc-brand-soft)' }}
      >
        <div>
          <div className="text-[11px] text-gray-500">{phrase}</div>
          <div className="text-base font-bold text-black">{party}</div>
        </div>
        <div className="text-end">
          <div className="text-[11px] text-gray-500">{voucherLabel('amount')}</div>
          <div className="num text-2xl font-bold" style={{ color: 'var(--doc-brand)' }}>
            {formatMoney(v.amount)}
          </div>
        </div>
      </div>

      {/* الطريقة والمرجع. */}
      <div className="grid grid-cols-2 gap-3 text-[12px]">
        <div className="flex justify-between border-b border-gray-100 pb-1">
          <span className="text-gray-500">{voucherLabel('method')}</span>
          <span className="font-medium text-black">{v.method}</span>
        </div>
        {v.reference && (
          <div className="flex justify-between border-b border-gray-100 pb-1">
            <span className="text-gray-500">{voucherLabel('reference')}</span>
            <span className="num font-medium text-black">{v.reference}</span>
          </div>
        )}
      </div>

      {/* التخصيصات — ما غطّاه السند من فواتير/مشتريات. */}
      {v.allocations && v.allocations.length > 0 && (
        <div className={cn('overflow-hidden border border-gray-200', style.cardRadius)}>
          <div className="bg-gray-50 px-3 py-1.5 text-[10px] font-bold uppercase tracking-wide text-gray-400">
            {voucherLabel('applied_to')}
          </div>
          <table className="w-full text-[12px]">
            <tbody>
              {v.allocations.map((a, i) => (
                <tr key={i} className="border-t border-gray-100">
                  <td className="px-3 py-1.5 text-gray-700">{a.label}</td>
                  <td className="num px-3 py-1.5 text-end font-medium text-black">{formatMoney(a.amount)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
