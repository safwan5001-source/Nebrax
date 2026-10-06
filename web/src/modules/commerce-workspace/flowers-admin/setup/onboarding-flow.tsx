'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import { CheckCircle2, ChevronLeft, ChevronRight, CircleDashed } from 'lucide-react';
import { ErrorState, LoadingState } from '@/components/nebrax';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { commerceWorkspaceMessage } from '@/modules/commerce-workspace/messages';
import { flowersAdminT, type FlowersAdminMessageKey } from '../messages';
import { resolveCurrentIndex, setupProgress, type SetupStep } from './derive';
import { CAPABILITY_LABEL, MISSING_TEXT, configuredText } from './setup-center';
import { StartersBox } from './starters-box';
import { useSetupState } from './use-setup-state';

const WHY: Record<string, FlowersAdminMessageKey> = {
  occasions: 'onbWhyOccasions',
  recipients: 'onbWhyRecipients',
  gift_message: 'onbWhyGiftMessage',
  delivery_scheduling: 'onbWhyDeliveryScheduling',
  same_day_delivery: 'onbWhySameDay',
  personalization: 'onbWhyPersonalization',
  add_ons: 'onbWhyAddOns',
  structured_content: 'onbWhyStructuredContent',
  vertical_sections: 'onbWhySections',
};

const requestedStep = () => (typeof window === 'undefined' ? null : new URLSearchParams(window.location.search).get('step'));

/**
 * FLOWERS-H2-12 — تهيئة موجَّهة لمتجر «الهدايا والورود»: تمرّ على القدرات بترتيب المركز نفسه، وكل خطوة تشرح ما
 * تفعله وتفتح الشاشة الحقيقية. **لا حالة مخزَّنة**: الخطوات وحالتها مشتقّة من الإعداد الفعلي (`useSetupState`)،
 * والموضع في الرابط (`?step=`) فتُستأنف التهيئة من حيث توقّفت حتى بعد العودة من شاشة أخرى. التخطّي مسموح دائماً —
 * الخطوة المتخطّاة تبقى «غير مهيّأة» ولا يُفعَّل شيء تلقائياً.
 */
export function OnboardingFlow({ storeId, locale }: { storeId: string; locale: string | undefined }) {
  const t = useMemo(() => flowersAdminT(locale), [locale]);
  const tc = useMemo(() => (key: Parameters<typeof commerceWorkspaceMessage>[1]) => commerceWorkspaceMessage(locale, key), [locale]);
  const { state, reload } = useSetupState(storeId);
  const [requested, setRequested] = useState<string | null>(null);
  useEffect(() => setRequested(requestedStep()), []);

  if (state.kind === 'loading') return <LoadingState variant="table" rows={4} label={t('loading')} />;
  if (state.kind === 'failed') return <ErrorState message={t('loadFailed')} retryLabel={t('retry')} onRetry={reload} />;

  const { steps } = state;
  const index = resolveCurrentIndex(steps, requested);
  if (index < 0) return <ErrorState message={t('loadFailed')} retryLabel={t('retry')} onRetry={reload} />;
  const step = steps[index];
  const progress = setupProgress(steps);
  const go = (target: number) => {
    const key = steps[target].key;
    setRequested(key);
    const url = new URL(window.location.href);
    url.searchParams.set('step', key);
    window.history.replaceState(null, '', url.toString());
  };

  return (
    <div className="grid gap-6 lg:grid-cols-[16rem_minmax(0,1fr)]" data-onboarding>
      <nav aria-label={t('onbStepsNav')} className="hidden lg:block">
        <ol className="divide-y divide-border rounded border border-border bg-surface">
          {steps.map((item, i) => (
            <li key={item.key}>
              <button
                type="button"
                onClick={() => go(i)}
                aria-current={i === index ? 'step' : undefined}
                data-onboarding-nav={item.key}
                className={cn(
                  'flex w-full items-center gap-2.5 px-3 py-2.5 text-start text-sm focus-visible:ring-2 focus-visible:ring-primary/40',
                  i === index ? 'bg-primary/5 font-medium text-text' : 'text-muted hover:bg-background',
                )}
              >
                <StatusIcon step={item} />
                <span className="min-w-0 flex-1 truncate">{tc(CAPABILITY_LABEL[item.key])}</span>
                <span className="sr-only">— {item.state === 'configured' ? t('setupDone') : t('setupTodo')}</span>
              </button>
            </li>
          ))}
        </ol>
      </nav>

      <section aria-labelledby="onboarding-step-title" className="min-w-0 max-w-2xl space-y-4" data-onboarding-step={step.key}>
        <div className="space-y-2">
          <div className="flex items-baseline justify-between gap-2">
            <p className="text-xs text-muted" data-onboarding-counter>{t('onbStepOf', { n: index + 1, total: steps.length })}</p>
            <p className="text-xs text-muted">{t('setupProgressCount', { done: progress.done, total: progress.total })}</p>
          </div>
          <div className="h-1.5 w-full overflow-hidden rounded-full bg-border" role="progressbar" aria-valuemin={1} aria-valuemax={steps.length} aria-valuenow={index + 1} aria-label={t('onbStepOf', { n: index + 1, total: steps.length })}>
            <div className="h-full rounded-full bg-primary" style={{ width: `${((index + 1) / steps.length) * 100}%` }} />
          </div>
        </div>

        <div className="space-y-3 rounded border border-border bg-surface p-4">
          <div className="flex items-start gap-2.5">
            <StatusIcon step={step} />
            <div className="min-w-0 space-y-1">
              <h2 id="onboarding-step-title" className="text-base font-semibold text-text">{tc(CAPABILITY_LABEL[step.key])}</h2>
              <p className="text-sm leading-6 text-muted">{t(WHY[step.key])}</p>
            </div>
          </div>
          <p className="text-xs leading-5 text-text" data-onboarding-status>
            {step.state === 'configured'
              ? `${t('onbDoneHere')} ${configuredText(step, t)}.`
              : step.missing.length > 0
                ? step.missing.map((reason) => t(MISSING_TEXT[reason])).join(' ')
                : t('setupTodo')}
          </p>
          {step.key === 'occasions' || step.key === 'recipients' ? <StartersBox storeId={storeId} locale={locale} onApplied={reload} /> : null}
          <Button asChild variant={step.state === 'configured' ? 'outline' : 'primary'} size="sm" className="w-full sm:w-auto">
            <Link href={step.href} data-onboarding-open>{t('onbOpen')}</Link>
          </Button>
        </div>

        <p className="text-xs leading-5 text-muted">{t('onbSkipNote')}</p>

        <div className="flex items-center justify-between gap-2" data-onboarding-actions>
          <Button type="button" variant="outline" size="sm" onClick={() => go(index - 1)} disabled={index === 0}>
            <ChevronRight className="h-4 w-4 rtl:rotate-0 ltr:rotate-180" aria-hidden="true" />
            {t('onbBack')}
          </Button>
          {index < steps.length - 1 ? (
            <Button type="button" size="sm" onClick={() => go(index + 1)} data-onboarding-next>
              {t('onbNext')}
              <ChevronLeft className="h-4 w-4 rtl:rotate-0 ltr:rotate-180" aria-hidden="true" />
            </Button>
          ) : (
            <Button asChild size="sm">
              <Link href="/commerce" data-onboarding-finish>{t('onbFinish')}</Link>
            </Button>
          )}
        </div>
        {progress.done === progress.total ? <p className="text-xs text-positive" data-onboarding-complete>{t('onbAllDone')}</p> : null}
      </section>
    </div>
  );
}

function StatusIcon({ step }: { step: SetupStep }) {
  return step.state === 'configured' ? (
    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-positive" strokeWidth={1.8} aria-hidden="true" />
  ) : (
    <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-muted" strokeWidth={1.8} aria-hidden="true" />
  );
}
