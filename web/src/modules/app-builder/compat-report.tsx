'use client';

import * as React from 'react';
import type { CompatReport } from '@/lib/app-builder';

type Translate = (key: string, values?: Record<string, string | number>) => string;

/** هل يستحق التقرير إظهاراً: حذفٌ اختياري على جيل ما، أو جيلٌ لا يعرض التجربة. (نظيف أو غائب ⇒ لا شيء.) */
export function compatNeedsAttention(report: CompatReport | null | undefined): report is CompatReport {
  return !!report && (report.has_drops || report.generations.some((g) => !g.compatible));
}

/** قائمة ما يُحذف/يفشل لكل جيل — تُستعمل في شريط المحرر وفي حوار النشر (لا حذف صامت). */
export function CompatDisclosure({ report, t, onOpen }: { report: CompatReport; t: Translate; onOpen?: (componentId: string) => void }) {
  return (
    <div className="space-y-2" data-testid="compat-disclosure">
      {report.generations.map((generation) => (
        <div key={generation.runtime} className="rounded border border-border bg-surface p-2 text-xs">
          <p className="font-medium text-text">{t('compat.generation', { runtime: generation.runtime })}</p>
          {!generation.compatible ? (
            <p className="mt-0.5 text-negative">{t('compat.incompatible')}</p>
          ) : generation.dropped.length === 0 ? (
            <p className="mt-0.5 text-muted">{t('compat.nothingDropped')}</p>
          ) : (
            <ul className="mt-1 space-y-1">
              {generation.dropped.map((item) => (
                <li key={item.component_id} className="flex flex-wrap items-center gap-2">
                  <span className="text-text">{t('compat.dropped', { type: item.component_type, id: item.component_id })}</span>
                  {onOpen ? (
                    <button type="button" className="text-primary underline" onClick={() => onOpen(item.component_id)}>
                      {t('compat.open')}
                    </button>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </div>
      ))}
      <p className="text-[11px] text-muted">
        {report.full_runtime ? t('compat.fullFrom', { runtime: report.full_runtime }) : t('compat.noFullRuntime')}
      </p>
    </div>
  );
}

/** شريط المحرر: غائب بلا ما يستحق؛ يوضّح ما سيُحذف قبل النشر. استشاري — لا يمنع شيئاً. */
export function CompatNotice({ report, t, onOpen }: { report: CompatReport | null | undefined; t: Translate; onOpen?: (componentId: string) => void }) {
  const [open, setOpen] = React.useState(false);
  if (!compatNeedsAttention(report)) return null;
  const dropped = new Set(report.generations.flatMap((g) => g.dropped.map((d) => d.component_id))).size;
  const incompatible = report.generations.some((g) => !g.compatible);
  return (
    <div role="status" data-testid="compat-notice" className="shrink-0 border-b border-border bg-primary-soft px-4 py-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-text">{incompatible ? t('compat.summaryIncompatible') : t('compat.summaryDrops', { count: dropped })}</span>
        <button type="button" className="text-primary underline" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
          {open ? t('compat.hide') : t('compat.show')}
        </button>
      </div>
      {open ? <div className="mt-2"><CompatDisclosure report={report} t={t} onOpen={onOpen} /></div> : null}
    </div>
  );
}
