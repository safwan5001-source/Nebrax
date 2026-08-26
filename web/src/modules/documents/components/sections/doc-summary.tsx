'use client';

import { cn } from '@/lib/utils';
import type { DocumentModel } from '../../types';
import { useDocStyle } from '../doc-style-context';
import { DocQr } from './doc-qr';
import { DocTotals } from './doc-totals';

/** صفّ الملخّص: يحافظ على QR والإجماليات ويغيّر تركيب العرض فقط حسب القالب. */
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
  const qr = showQr ? <DocQr model={model} /> : null;
  const totals = <DocTotals model={model} formatMoney={formatMoney} />;

  if (style.composition === 'erp') {
    return (
      <section className={cn('flex items-end justify-between gap-8', style.sectionGap)}>
        <div className="min-h-[1px]">{qr}</div>
        {totals}
      </section>
    );
  }

  if (style.composition === 'modern') {
    return (
      <section className={cn('grid grid-cols-12 items-end gap-6', style.sectionGap)}>
        <div className="col-span-4">{qr}</div>
        <div className="col-span-5 col-start-8 flex justify-end">{totals}</div>
      </section>
    );
  }

  if (style.composition === 'minimal') {
    return (
      <section className={cn('flex items-start justify-between gap-8', style.sectionGap)}>
        <div>{qr}</div>
        {totals}
      </section>
    );
  }

  return (
    <div className={cn('flex items-start justify-between gap-6', style.sectionGap)}>
      {qr ?? <div />}
      {totals}
    </div>
  );
}
