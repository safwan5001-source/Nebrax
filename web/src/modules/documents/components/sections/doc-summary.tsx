'use client';

import { cn } from '@/lib/utils';
import type { DocumentModel } from '../../types';
import { useDocStyle } from '../doc-style-context';
import { DocQr } from './doc-qr';
import { DocTotals } from './doc-totals';

/** صفّ الملخّص: رمز QR (أو فراغ) + كتلة الإجماليات. */
export function DocSummary({
  model,
  formatMoney,
  showQr,
}: {
  model: DocumentModel;
  formatMoney: (minor: number) => string;
  showQr: boolean;
}) {
  const style = useDocStyle();
  return (
    <div className={cn('flex items-start justify-between gap-6', style.sectionGap)}>
      {showQr ? <DocQr model={model} /> : <div />}
      <DocTotals model={model} formatMoney={formatMoney} />
    </div>
  );
}
