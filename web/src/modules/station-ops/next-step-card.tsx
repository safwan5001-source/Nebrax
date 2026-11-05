'use client';

import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { CircleCheck, Clock, Hourglass } from 'lucide-react';
import type { NextStep } from './next-step';

/**
 * بطاقة «الخطوة التالية» — نص بلغة الموظف داخل التطبيق. UI-2: الخطوة التي صارت تُنفَّذ فعلاً (فتح الوردية/القراءات/التسليم) تحمل
 * زراً أساسياً واحداً **داخل التطبيق** لمن يملك صلاحيتها (`showAction`)، وما لم يُنفَّذ (اعتماد المشرف) يبقى نصاً بلا زر ولا وعد.
 * `showAction={false}` للرئيسية: زرّها الأساسي منفصل (زر واحد في الشاشة).
 */
export function NextStepCard({ step, showAction = true }: { step: NextStep; showAction?: boolean }) {
  const t = useTranslations('stationOps');
  const done = step.kind === 'complete';
  const Icon = done ? CircleCheck : step.mine ? Clock : Hourglass;
  const what = done ? '' : t(`next.kind.${step.kind}`); // `complete` لا نصّ خطوة له
  const detail = step.remaining !== null && (step.kind === 'opening_readings' || step.kind === 'closing_readings')
    ? t('next.remaining', { count: String(step.remaining) })
    : null;

  return (
    <section aria-labelledby="fo-next-h" data-next-step={step.kind} className="rounded-[14px] border border-border bg-surface p-4">
      <h2 id="fo-next-h" className="text-xs font-semibold text-muted">{t('next.title')}</h2>
      <div className="mt-2 flex items-start gap-3">
        <span aria-hidden="true" className={`mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full ${done ? 'bg-[color:var(--fo-positive-tint)] text-positive' : 'bg-primary-soft text-primary'}`}>
          <Icon className="h-5 w-5" strokeWidth={1.9} />
        </span>
        <div className="min-w-0 flex-1">
          <p className="text-base font-semibold leading-6 text-text">{done ? t('next.complete') : step.mine ? what : t('next.waiting', { step: what })}</p>
          {detail ? <p className="mt-0.5 text-sm text-muted">{detail}</p> : null}
          {!done && step.mine && step.href === null ? (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-md border border-border px-2 py-0.5 text-xs text-muted">
              <Clock aria-hidden="true" className="h-3 w-3" strokeWidth={1.8} />
              {t('next.soon')}
            </p>
          ) : null}
          {!done && step.mine && step.href !== null && showAction ? (
            <Link
              href={step.href}
              data-primary-action=""
              className="mt-3 flex min-h-12 w-full items-center justify-center rounded-[13px] bg-[color:var(--fo-cta-bg)] px-4 text-[15px] font-bold text-[color:var(--fo-cta-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 focus-visible:ring-offset-background"
            >
              {what}
            </Link>
          ) : null}
        </div>
      </div>
    </section>
  );
}
