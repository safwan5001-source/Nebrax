'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { CheckCircle2, CircleDashed } from 'lucide-react';
import { ErrorState, LoadingState } from '@/components/nebrax';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { commerceWorkspaceMessage } from '@/modules/commerce-workspace/messages';
import { flowersAdminT, type FlowersAdminMessageKey } from '../messages';
import { groupSteps, nextStep, setupProgress, type MissingReason, type SetupGroupId, type SetupStep } from './derive';
import { StartersBox } from './starters-box';
import { useSetupState } from './use-setup-state';

type CommerceKey = Parameters<typeof commerceWorkspaceMessage>[1];

/** مفتاح القدرة من الخادم → نص موجود في حزمة التجارة (نفس نصوص قائمة الإعداد القديمة، فلا تُكرَّر). */
const CAPABILITY_LABEL: Record<string, CommerceKey> = {
  occasions: 'storeCapOccasions',
  recipients: 'storeCapRecipients',
  gift_message: 'storeCapGiftMessage',
  personalization: 'storeCapPersonalization',
  add_ons: 'storeCapAddOns',
  delivery_scheduling: 'storeCapDeliveryScheduling',
  same_day_delivery: 'storeCapSameDayDelivery',
  structured_content: 'storeCapStructuredContent',
  vertical_sections: 'storeCapVerticalSections',
};

const GROUP_LABEL: Record<SetupGroupId, FlowersAdminMessageKey> = {
  catalog: 'setupGroupCatalog',
  gifting: 'setupGroupGifting',
  delivery: 'setupGroupDelivery',
  products: 'setupGroupProducts',
  presentation: 'setupGroupPresentation',
};

/** وصف الحالة المهيّأة بحسب معنى عدّاد كل قدرة (قيم، فترات، منتجات، أقسام). */
function configuredText(step: SetupStep, t: ReturnType<typeof flowersAdminT>): string {
  switch (step.key) {
    case 'occasions':
    case 'recipients':
      return t('setupCountValues', { n: step.count });
    case 'gift_message':
      return t('setupCountOn');
    case 'delivery_scheduling':
      return t('setupCountWindows', { n: step.count });
    case 'same_day_delivery':
      return t('setupCountReady');
    case 'vertical_sections':
      return t('setupCountSections', { n: step.count });
    default:
      return t('setupCountProducts', { n: step.count });
  }
}

const MISSING_TEXT: Record<MissingReason, FlowersAdminMessageKey> = {
  no_values: 'setupMissNoValues',
  gift_off: 'setupMissGiftOff',
  schedule_off: 'setupMissScheduleOff',
  no_windows: 'setupMissNoWindows',
  needs_scheduling: 'setupMissNeedsScheduling',
  no_warehouse: 'setupMissNoWarehouse',
  warehouse_inactive: 'setupMissWarehouseInactive',
  no_products: 'setupMissNoProducts',
  no_section: 'setupMissNoSection',
};

/**
 * FLOWERS-H2-11 — مركز إعداد «الهدايا والورود»: لكل قدرة حالتها الفعلية (مشتقّة من الخادم لا مخزَّنة)، وما ينقصها
 * بلغة التاجر، ورابطٌ إلى الشاشة الحقيقية التي تعالجه. المجموعات: الفهرس والاكتشاف · الإهداء · التوصيل · المنتجات ·
 * عرض المتجر. قدرات المنتجات تتطلب اختيار منتج أولاً (الإعداد لكل منتج) فنقول ذلك صراحةً.
 */
export function SetupCenter({ storeId, locale }: { storeId: string; locale: string | undefined }) {
  const t = useMemo(() => flowersAdminT(locale), [locale]);
  const tc = useMemo(() => (key: CommerceKey) => commerceWorkspaceMessage(locale, key), [locale]);
  const { state, reload } = useSetupState(storeId);

  if (state.kind === 'loading') return <LoadingState variant="table" rows={5} label={t('loading')} />;
  if (state.kind === 'failed') return <ErrorState message={t('loadFailed')} retryLabel={t('retry')} onRetry={reload} />;

  const { steps } = state;
  const progress = setupProgress(steps);
  const next = nextStep(steps);
  const percent = progress.total === 0 ? 0 : Math.round((progress.done / progress.total) * 100);

  return (
    <div className="max-w-3xl space-y-6" data-setup-center>
      <section aria-labelledby="setup-progress-title" className="space-y-2 rounded border border-border bg-surface p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 id="setup-progress-title" className="text-sm font-semibold text-text">{t('setupProgressTitle')}</h2>
          <span className="text-sm text-text" data-setup-progress>
            {t('setupProgressCount', { done: progress.done, total: progress.total })}
          </span>
        </div>
        <div className="h-1.5 w-full overflow-hidden rounded-full bg-border" role="progressbar" aria-valuemin={0} aria-valuemax={progress.total} aria-valuenow={progress.done} aria-labelledby="setup-progress-title">
          <div className="h-full rounded-full bg-primary transition-[width]" style={{ width: `${percent}%` }} />
        </div>
        {next ? (
          <div className="flex flex-wrap items-center justify-between gap-2 pt-1">
            <p className="text-xs text-muted">
              {t('setupNext')}: <span className="text-text">{tc(CAPABILITY_LABEL[next.key])}</span>
            </p>
            <Button asChild size="sm">
              <Link href={next.href} data-setup-next>{t('setupContinue')}</Link>
            </Button>
          </div>
        ) : (
          <p className="text-xs text-positive" data-setup-complete>{t('setupAllDone')}</p>
        )}
        <p className="text-xs leading-5 text-muted">{t('setupDerivedNote')}</p>
      </section>

      {groupSteps(steps).map(({ group, steps: groupItems }) => (
        <section key={group} aria-labelledby={`setup-group-${group}`} className="space-y-2" data-setup-group={group}>
          <h2 id={`setup-group-${group}`} className="text-sm font-semibold text-text">{t(GROUP_LABEL[group])}</h2>
          <ul className="divide-y divide-border rounded border border-border bg-surface">
            {groupItems.map((step) => (
              <StepRow key={step.key} step={step} label={tc(CAPABILITY_LABEL[step.key])} t={t} />
            ))}
          </ul>
          {group === 'catalog' ? <StartersBox storeId={storeId} locale={locale} onApplied={reload} /> : null}
        </section>
      ))}
    </div>
  );
}

function StepRow({ step, label, t }: { step: SetupStep; label: string; t: ReturnType<typeof flowersAdminT> }) {
  const done = step.state === 'configured';

  return (
    <li className="flex flex-col gap-2 px-4 py-3 text-sm sm:flex-row sm:items-center sm:justify-between sm:gap-4" data-setup-step={step.key} data-state={step.state}>
      <div className="flex min-w-0 items-start gap-2.5">
        {done ? (
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-positive" strokeWidth={1.8} aria-hidden="true" />
        ) : (
          <CircleDashed className="mt-0.5 h-4 w-4 shrink-0 text-muted" strokeWidth={1.8} aria-hidden="true" />
        )}
        <div className="min-w-0 space-y-0.5">
          <p className="font-medium text-text">
            {label} <span className="sr-only">— {done ? t('setupDone') : t('setupTodo')}</span>
          </p>
          <p className={cn('text-xs leading-5', done ? 'text-muted' : 'text-muted')}>
            {done
              ? configuredText(step, t)
              : step.missing.length > 0
                ? step.missing.map((reason) => t(MISSING_TEXT[reason])).join(' ')
                : t('setupTodo')}
            {step.needsProduct ? ` ${t('setupPickProduct')}` : ''}
          </p>
        </div>
      </div>
      <Button asChild variant={done ? 'outline' : 'primary'} size="sm" className="w-full shrink-0 sm:w-auto">
        <Link href={step.href}>{done ? t('setupManage') : t('setupComplete')}</Link>
      </Button>
    </li>
  );
}
