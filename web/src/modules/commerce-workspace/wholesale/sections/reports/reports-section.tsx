'use client';

import { useMemo, useState, type ReactNode } from 'react';
import Link from 'next/link';
import { useLocale } from 'next-intl';
import { ExternalLink, ShieldAlert } from 'lucide-react';
import { EmptyState } from '@/components/nebrax';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { Label } from '@/components/ui/label';
import { useCan } from '@/lib/use-can';
import { useWholesaleChannel } from '../../channel-context';
import { SectionPage } from '../../components/section-page';
import { StatCard } from '../../components/stat-card';
import { ResourceBoundary } from '../../components/resource-boundary';
import { UnavailablePanel } from '../../components/unavailable-panel';
import { useResource } from '../../use-resource';
import {
  DELIVERY_METHOD_VALUES,
  LIFECYCLE_VALUES,
  PAYMENT_METHOD_VALUES,
  PAYMENT_STATUS_VALUES,
  PERIOD_PRESETS,
  countMemberships,
  countOrders,
  countOrdersBy,
  periodFrom,
  type CountRow,
  type PeriodPreset,
} from './api';
import { CountBars } from './count-bars';
import { reportsMessages } from './messages';

export const AWJ_REPORTS_HREF = '/reports';

/**
 * Reports & Analytics — only server-counted figures for the wholesale channel (see `api.ts`). Each card loads on its
 * own, so one failing metric never blanks the page. Revenue / AOV / top-N / posting status have no channel-scoped
 * source and are listed as deferred with their exact blocker.
 */
export function ReportsSection() {
  const locale = useLocale();
  const { t } = reportsMessages.forLocale(locale);
  return (
    <SectionPage sectionKey="reports" description={t('description')}>
      <ReportsBody />
    </SectionPage>
  );
}

function ReportsBody() {
  const locale = useLocale();
  const { t } = reportsMessages.forLocale(locale);
  const { channelId } = useWholesaleChannel();
  const [period, setPeriod] = useState<PeriodPreset>('30');
  const from = useMemo(() => periodFrom(period), [period]);

  if (channelId === null) return null;

  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-end gap-x-4 gap-y-2">
        <div className="min-w-44 space-y-1">
          <Label htmlFor="wh-report-period">{t('periodLabel')}</Label>
          <Select id="wh-report-period" value={period} onChange={(event) => setPeriod(event.target.value as PeriodPreset)}>
            {PERIOD_PRESETS.map((preset) => (
              <option key={preset} value={preset}>
                {t(`period.${preset}` as 'period.all')}
              </option>
            ))}
          </Select>
        </div>
        <p className="max-w-xl pb-1 text-xs text-muted">{t('periodNote')}</p>
      </div>

      <TotalCard channelId={channelId} from={from} period={period} />

      <div className="grid gap-4 lg:grid-cols-2">
        <OrdersGroup channelId={channelId} from={from} period={period} filter="lifecycle_status" values={LIFECYCLE_VALUES} prefix="lifecycle" title={t('groupLifecycle')} />
        <OrdersGroup
          channelId={channelId}
          from={from}
          period={period}
          filter="payment_status"
          values={PAYMENT_STATUS_VALUES}
          prefix="payment"
          title={t('groupPaymentStatus')}
          hint={t('groupPaymentStatusHint')}
        />
        <OrdersGroup channelId={channelId} from={from} period={period} filter="payment_method" values={PAYMENT_METHOD_VALUES} prefix="method" title={t('groupPaymentMethod')} />
        <OrdersGroup channelId={channelId} from={from} period={period} filter="delivery_method" values={DELIVERY_METHOD_VALUES} prefix="delivery" title={t('groupDelivery')} />
        <BuyersGroup channelId={channelId} />
      </div>

      <div className="grid gap-3 lg:grid-cols-3">
        <UnavailablePanel title={t('deferredRevenueTitle')} description={t('deferredRevenueDescription')} blocker={t('deferredRevenueBlocker')} />
        <UnavailablePanel title={t('deferredTopTitle')} description={t('deferredTopDescription')} blocker={t('deferredTopBlocker')} />
        <UnavailablePanel title={t('deferredAccountingTitle')} description={t('deferredAccountingDescription')} blocker={t('deferredAccountingBlocker')} />
      </div>

      <section className="flex flex-wrap items-center justify-between gap-3 rounded border border-border bg-surface p-3">
        <div className="min-w-0">
          <h2 className="text-sm font-medium text-text">{t('awjReportsTitle')}</h2>
          <p className="text-sm text-muted">{t('awjReportsBody')}</p>
        </div>
        <Button asChild variant="outline">
          <Link href={AWJ_REPORTS_HREF}>
            <ExternalLink aria-hidden className="h-4 w-4" strokeWidth={1.7} />
            {t('openReports')}
          </Link>
        </Button>
      </section>
    </div>
  );
}

function TotalCard({ channelId, from, period }: { channelId: string; from: string | null; period: PeriodPreset }) {
  const { t } = reportsMessages.forLocale(useLocale());
  const { state } = useResource(() => countOrders(channelId, from), [channelId, period]);
  return (
    <div className="max-w-xs">
      <StatCard
        label={t('totalOrders')}
        hint={t('totalOrdersHint')}
        loading={state.status === 'loading'}
        unavailable={state.status === 'error' ? t('loadError') : undefined}
        value={state.status === 'ready' ? state.data : undefined}
      />
    </div>
  );
}

function Panel({ title, hint, children }: { title: string; hint?: string; children: ReactNode }) {
  return (
    <section aria-label={title} className="space-y-3 rounded border border-border bg-surface p-4">
      <div>
        <h2 className="text-sm font-semibold text-text">{title}</h2>
        {hint ? <p className="text-xs text-muted">{hint}</p> : null}
      </div>
      {children}
    </section>
  );
}

function OrdersGroup({
  channelId,
  from,
  period,
  filter,
  values,
  prefix,
  title,
  hint,
}: {
  channelId: string;
  from: string | null;
  period: PeriodPreset;
  filter: 'payment_status' | 'payment_method' | 'delivery_method' | 'lifecycle_status';
  values: readonly string[];
  prefix: 'lifecycle' | 'payment' | 'method' | 'delivery';
  title: string;
  hint?: string;
}) {
  const { t, label } = reportsMessages.forLocale(useLocale());
  const { state, reload } = useResource(() => countOrdersBy(channelId, from, filter, values), [channelId, period, filter]);
  return (
    <Panel title={title} hint={hint}>
      <ResourceBoundary state={state} onRetry={reload} loadingVariant="cards" loadingRows={1}>
        {(rows: CountRow[]) => (
          <CountBars
            emptyText={t('barsEmpty')}
            rows={rows.map((row) => ({ key: row.value, label: label(prefix, row.value), count: row.count, valueText: t('count', { n: row.count }) }))}
          />
        )}
      </ResourceBoundary>
    </Panel>
  );
}

function BuyersGroup({ channelId }: { channelId: string }) {
  const { t, label } = reportsMessages.forLocale(useLocale());
  const { can } = useCan();
  const allowed = can('commerce.wholesale.manage');
  const { state, reload } = useResource(() => countMemberships(channelId), [channelId], { enabled: allowed });
  return (
    <Panel title={t('groupBuyers')} hint={t('groupBuyersHint')}>
      {allowed ? (
        <ResourceBoundary state={state} onRetry={reload} loadingVariant="cards" loadingRows={1}>
          {(rows: CountRow[]) => (
            <CountBars
              emptyText={t('barsEmpty')}
              rows={rows.map((row) => ({ key: row.value, label: label('membership', row.value), count: row.count, valueText: t('countBuyers', { n: row.count }) }))}
            />
          )}
        </ResourceBoundary>
      ) : (
        <EmptyState icon={ShieldAlert} surface="bare" title={t('buyersForbiddenTitle')} description={t('buyersForbiddenBody')} />
      )}
    </Panel>
  );
}
