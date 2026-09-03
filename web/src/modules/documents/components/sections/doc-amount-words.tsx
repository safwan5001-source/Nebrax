'use client';

import { useLocale, useTranslations } from 'next-intl';
import { cn } from '@/lib/utils';
import type { DocumentModel } from '../../types';
import { useDocStyle } from '../doc-style-context';
import { amountToWords } from '../../utils/amount-words';
import { useDocumentLabelMode } from '../../presentation/use-document-label-mode';
import { ModernFieldLabel } from '../../presentation/modern-bilingual-label';

/**
 * المبلغ بالحروف (تفقيط) — قسم مشترك للفواتير والسندات. يأخذ مبلغ السند إن وُجد،
 * وإلا إجمالي المستند، ويصوغه بلغة الواجهة الحالية.
 */
export function DocAmountWords({ model }: { model: DocumentModel }) {
  const t = useTranslations('invoiceDoc');
  const locale = useLocale();
  const style = useDocStyle();
  const { mode } = useDocumentLabelMode(model);

  const amount = model.voucher ? model.voucher.amount : model.totals.total;
  const words = amountToWords(amount, model.currency, locale === 'en' ? 'en' : 'ar');

  return (
    <div className={cn('border border-gray-200 bg-gray-50 px-3 py-2', style.cardRadius, style.sectionGap)}>
      <span className="text-[10px] font-bold uppercase tracking-wide text-gray-400">
        {style.composition === 'modern_v2' || style.composition === 'erp_v2' || style.composition === 'classic_v2' || style.composition === 'minimal_v2' || style.composition === 'retail_v2' ? <ModernFieldLabel field="amount_words" mode={mode} /> : t('amount_words')}:{' '}
      </span>
      <span className="text-[12px] font-medium text-gray-800">{words}</span>
    </div>
  );
}
