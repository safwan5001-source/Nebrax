'use client';

import { useLocale, useTranslations } from 'next-intl';
import { ArrowRight, Check, Circle, Minus, type LucideIcon } from 'lucide-react';
import { formatStampInZone } from './format';
import type { ProgressStep, StepState } from './readings';

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
    <div>
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
    </div>
  );
}

/** ملخص مضغوط للتقدم: «الخطوة 2 من 5: قراءات الإغلاق» + خمسة مقاطع. الحالة نص أولاً، واللون مساند. */
export function ProgressSummary({ steps }: { steps: ProgressStep[] }) {
  const t = useTranslations('stationOps');
  const currentIndex = steps.findIndex((step) => step.state === 'current');
  const finished = steps.every((step) => step.state === 'done' || step.state === 'none');
  const label = finished
    ? t('shiftDetail.allDone')
    : currentIndex >= 0
      ? t('shiftDetail.stepOf', { n: String(currentIndex + 1), total: String(steps.length), label: t(`shiftDetail.progress.step.${steps[currentIndex].key}`) })
      : null;
  if (label === null) return null;
  return (
    <div data-progress-summary="">
      <p className="text-sm font-medium text-text tabular-nums">{label}</p>
      <div aria-hidden="true" className="mt-2 flex gap-1">
        {steps.map((step) => (
          <span key={step.key} className={`h-1.5 flex-1 rounded-full ${step.state === 'done' ? 'bg-positive' : step.state === 'current' ? 'bg-primary' : 'bg-border'}`} />
        ))}
      </div>
    </div>
  );
}
