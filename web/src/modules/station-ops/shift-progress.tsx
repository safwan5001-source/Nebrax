'use client';

import { useLocale, useTranslations } from 'next-intl';
import { ArrowRight, Check, Circle, Minus, type LucideIcon } from 'lucide-react';
import { formatStampInZone } from './format';
import type { ProgressStep, StepState } from './readings';
import { InlineNote } from './state-views';

/** UI-1 — التقدم في الوردية: خمس خطوات تتبع حالات الخادم (مفتوحة ← مغلقة ← معتمدة) وقراءات العدادات. الحالة نص + أيقونة. */

const STATE_VIEW: Record<StepState, { Icon: LucideIcon; ring: string }> = {
  done: { Icon: Check, ring: 'bg-[color:var(--fo-positive-tint)] text-positive' },
  current: { Icon: ArrowRight, ring: 'bg-primary-soft text-primary' },
  pending: { Icon: Circle, ring: 'border border-border text-muted' },
  none: { Icon: Minus, ring: 'border border-border text-muted' },
};

export function ProgressSection({ steps, timeZone }: { steps: ProgressStep[]; timeZone?: string | null }) {
  const t = useTranslations('stationOps');
  const locale = useLocale();
  return (
    <section aria-labelledby="fo-progress-h" className="space-y-3">
      <h2 id="fo-progress-h" className="text-base font-semibold text-text">{t('shiftDetail.progress.title')}</h2>
      <ol className="divide-y divide-border rounded-[14px] border border-border bg-surface px-4">
        {steps.map((step) => {
          const { Icon, ring } = STATE_VIEW[step.state];
          const detail = step.count
            ? step.count.total === null
              ? t('shiftDetail.progress.countOnly', { done: String(step.count.done) })
              : t('shiftDetail.progress.countOf', { done: String(step.count.done), total: String(step.count.total) })
            : step.at && step.state === 'done'
              ? formatStampInZone(step.at, locale, timeZone)
              : null;
          return (
            <li key={step.key} aria-current={step.state === 'current' ? 'step' : undefined} className="flex items-start gap-3 py-3">
              <span aria-hidden="true" className={`mt-0.5 grid h-7 w-7 shrink-0 place-items-center rounded-full ${ring}`}>
                <Icon className="h-4 w-4" strokeWidth={2} />
              </span>
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-text">{t(`shiftDetail.progress.step.${step.key}`)}</p>
                <p className="mt-0.5 text-xs text-muted">
                  <span className="font-medium">{t(`shiftDetail.progress.state.${step.state}`)}</span>
                  {detail ? <> · <span className="tabular-nums">{detail}</span></> : null}
                </p>
              </div>
            </li>
          );
        })}
      </ol>
      <InlineNote>{t('shiftDetail.progress.note')}</InlineNote>
    </section>
  );
}
