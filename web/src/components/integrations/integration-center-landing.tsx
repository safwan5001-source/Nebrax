'use client';

import { useId } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Bike, Check, ChevronRight, CreditCard, LayoutGrid, ShoppingBag, Truck, type LucideIcon } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import {
  INTEGRATION_CATEGORIES,
  type DeliveryAccess,
  type DeliverySummary,
  type IntegrationCategoryKey,
} from '@/lib/integration-center';

/**
 * صفحة مركز التكاملات (INT-UX-1) — عرض فقط، بلا شبكة. الحالة تأتي من الحاوية.
 *
 * البطاقة الوحيدة الفاعلة: منصات التوصيل، وتدخل القسم القائم (`/delivery-platforms`)
 * بلا مسار مكرر. الثلاث الباقيات **خاملة بنيوياً**: عناصر `div` بلا رابط ولا زر ولا
 * `tabindex` ولا دور تفاعلي، فلا يصلها Tab ولا نقر (قاعدة R-CAT في وثيقة التصميم).
 * لا يوجد هنا أي فعل ربط أو تفويض أو مزامنة ولا شارة تُوحي بشراكة (R-COPY-3).
 *
 * الخاملة تتميّز بحدّ متقطّع لا بشفافية: الشفافية تُخفّض تباين النص تحت AA.
 */

const ICONS: Record<IntegrationCategoryKey, LucideIcon> = {
  delivery: Bike,
  ecommerce: ShoppingBag,
  payments: CreditCard,
  shipping: Truck,
};

export type SummaryStatus = 'loading' | 'ready' | 'error';

export function IntegrationCenterLanding({
  access,
  summary,
  summaryStatus,
  canOpenApplications,
  onRetry,
}: {
  access: DeliveryAccess;
  summary: DeliverySummary | null;
  summaryStatus: SummaryStatus;
  canOpenApplications: boolean;
  onRetry: () => void;
}) {
  const t = useTranslations('integrationCenter');
  const headingId = useId();

  return (
    <div className="space-y-4" data-testid="integration-center">
      <section
        aria-labelledby={headingId}
        className="rounded-lg border border-border bg-surface p-4 sm:p-5"
      >
        <header className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h1 id={headingId} className="text-xl font-semibold text-text">{t('title')}</h1>
            <p className="mt-1 max-w-2xl text-sm leading-relaxed text-muted">{t('subtitle')}</p>
          </div>
          <LayoutGrid className="mt-1 h-6 w-6 shrink-0 text-muted" strokeWidth={1.6} aria-hidden="true" />
        </header>

        {access === 'checking' ? (
          <div
            className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2"
            role="status"
            aria-busy="true"
            aria-label={t('loading')}
            data-testid="integration-center-loading"
          >
            {INTEGRATION_CATEGORIES.map((category) => (
              <Skeleton key={category.key} className="h-40 w-full" />
            ))}
          </div>
        ) : (
          <ul className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2" role="list">
            {INTEGRATION_CATEGORIES.map((category) => (
              <li key={category.key} className="flex">
                {category.key === 'delivery' ? (
                  <DeliveryCard
                    href={category.href}
                    access={access}
                    summary={summary}
                    summaryStatus={summaryStatus}
                    canOpenApplications={canOpenApplications}
                  />
                ) : (
                  <PlannedCard categoryKey={category.key} />
                )}
              </li>
            ))}
          </ul>
        )}

        {access !== 'checking' ? (
          <p className="mt-3 text-xs leading-relaxed text-muted" data-testid="integration-center-planned-note">
            {t('plannedNote')}
          </p>
        ) : null}
      </section>

      {access === 'allowed' && summaryStatus === 'error' ? (
        <div
          role="alert"
          className="flex flex-wrap items-center justify-between gap-2 rounded border border-border bg-surface px-3 py-2 text-sm text-negative"
          data-testid="integration-center-summary-error"
        >
          <span>{t('summaryError')}</span>
          <Button type="button" variant="outline" size="sm" onClick={onRetry}>{t('retry')}</Button>
        </div>
      ) : null}
    </div>
  );
}

function DeliveryCard({
  href,
  access,
  summary,
  summaryStatus,
  canOpenApplications,
}: {
  href: string | null;
  access: Exclude<DeliveryAccess, 'checking'>;
  summary: DeliverySummary | null;
  summaryStatus: SummaryStatus;
  canOpenApplications: boolean;
}) {
  const t = useTranslations('integrationCenter');
  const titleId = useId();
  const descId = useId();
  const Icon = ICONS.delivery;

  if (access !== 'allowed' || href === null) {
    return (
      <div
        className="flex w-full flex-col gap-2 rounded-md border border-dashed border-border bg-surface p-4"
        data-testid="integration-card-delivery"
        data-state={access}
      >
        <Icon className="h-6 w-6 text-muted" strokeWidth={1.6} aria-hidden="true" />
        <h2 className="text-base font-semibold text-text">{t('delivery.title')}</h2>
        <p role="note" className="text-sm leading-relaxed text-muted">
          {access === 'denied' ? t('delivery.denied') : t('delivery.appOff')}
        </p>
        {access === 'app_off' && canOpenApplications ? (
          <Link
            href="/applications"
            className="w-fit text-sm font-medium text-primary underline-offset-2 hover:underline focus-visible:rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
          >
            {t('delivery.manageApplications')}
          </Link>
        ) : null}
      </div>
    );
  }

  return (
    <Link
      href={href}
      aria-labelledby={titleId}
      aria-describedby={descId}
      data-testid="integration-card-delivery"
      data-state="allowed"
      className="group flex w-full flex-col gap-2 rounded-md border border-border bg-surface p-4 transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
        <div className="flex items-start justify-between gap-2">
          <Icon className="h-6 w-6 text-primary" strokeWidth={1.6} aria-hidden="true" />
          <ChevronRight className="mt-1 h-4 w-4 shrink-0 text-muted rtl:rotate-180" strokeWidth={1.7} aria-hidden="true" />
        </div>
        <h2 id={titleId} className="text-base font-semibold text-text">{t('delivery.title')}</h2>
        <div id={descId} className="space-y-1.5">
          <p className="text-sm leading-relaxed text-muted">{t('delivery.description')}</p>
          <div>
            <Badge tone="neutral">
              <Check className="h-3 w-3" aria-hidden="true" />
              {t('delivery.badge')}
            </Badge>
          </div>
          <SummaryLines summary={summary} status={summaryStatus} />
        </div>
    </Link>
  );
}

function SummaryLines({ summary, status }: { summary: DeliverySummary | null; status: SummaryStatus }) {
  const t = useTranslations('integrationCenter');

  if (status === 'loading') {
    return (
      <div className="space-y-1.5" aria-hidden="true" data-testid="integration-center-summary-loading">
        <Skeleton className="h-3.5 w-48 max-w-full" />
        <Skeleton className="h-3.5 w-40 max-w-full" />
      </div>
    );
  }
  if (status === 'error' || summary === null) return null;

  return (
    <ul className="space-y-0.5 text-xs text-muted" data-testid="integration-center-summary">
      {summary.setUp !== null ? (
        <li>{t('delivery.setUp', { count: summary.setUp, total: summary.total })}</li>
      ) : null}
      {summary.nativeAvailable !== null ? (
        <li>
          {summary.nativeAvailable === 0
            ? t('delivery.nativeNone')
            : t('delivery.nativeSome', { count: summary.nativeAvailable })}
        </li>
      ) : null}
    </ul>
  );
}

function PlannedCard({ categoryKey }: { categoryKey: Exclude<IntegrationCategoryKey, 'delivery'> }) {
  const t = useTranslations('integrationCenter');
  const Icon = ICONS[categoryKey];

  return (
    <div
      className="flex w-full flex-col gap-2 rounded-md border border-dashed border-border bg-surface p-4"
      data-testid={`integration-card-${categoryKey}`}
      data-inert="true"
    >
      <Icon className="h-6 w-6 text-muted" strokeWidth={1.6} aria-hidden="true" />
      <h2 className="text-base font-semibold text-text">{t(`${categoryKey}.title`)}</h2>
      <p className="text-sm text-muted">{t('planned')}</p>
    </div>
  );
}
