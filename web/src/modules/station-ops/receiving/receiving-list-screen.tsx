'use client';

import Link from 'next/link';
import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Plus } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageMasthead, ScreenBody } from '../masthead';
import { StationOpsError } from '../read-client';
import { EmptyState, ErrorState, LoadingBlock } from '../state-views';
import { StationGate } from '../station-gate';
import { SecondaryButton } from '../write-ui';
import { Badge, LinkCard } from '../admin/ui';
import { useDeliveryList, useReceivingAccess, type StatusFilter } from './data';
import { Cost, Liters, RECEIVING_BASE, StatusBadge, VarianceText, deliveryTitle, when } from './parts';
import type { Delivery } from './schemas';
import type { Station } from '../schemas';

const FILTERS: readonly StatusFilter[] = ['all', 'draft', 'approved'];

function Row({ row }: { row: Delivery }) {
  const t = useTranslations('stationOps');
  const locale = useLocale();
  const title = deliveryTitle(row, t('receiving.untitled'));
  const hint = [row.supplier?.name, row.tank?.name].filter((part): part is string => !!part).join(' · ');
  return (
    <li className="space-y-1.5">
      <LinkCard href={`${RECEIVING_BASE}/${row.id}`} title={title} hint={hint || undefined} trailing={<StatusBadge status={row.status} />} />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-2 pb-2 text-sm text-muted">
        <span>{t('receiving.list.received')}: <Liters ml={row.received_milliliters} /></span>
        <span><VarianceText ml={row.transit_variance_milliliters} /></span>
        {row.received_total_cost_minor !== undefined ? <span>{t('receiving.list.cost')}: <Cost minor={row.received_total_cost_minor} /></span> : null}
        <span className="num">{when(row.received_at ?? row.created_at, locale)}</span>
      </div>
    </li>
  );
}

function List({ station }: { station: Station }) {
  const t = useTranslations('stationOps');
  const access = useReceivingAccess();
  const [status, setStatus] = useState<StatusFilter>('all');
  const [page, setPage] = useState(1);
  const list = useDeliveryList(station, status, page);

  return (
    <>
      {access.canStart ? (
        <Link
          href={`${RECEIVING_BASE}/new`}
          data-primary-action=""
          className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[13px] bg-[color:var(--fo-cta-bg)] px-4 text-[15px] font-bold text-[color:var(--fo-cta-fg)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
        >
          <Plus aria-hidden="true" className="h-5 w-5" strokeWidth={2} />
          {t('receiving.list.new')}
        </Link>
      ) : access.create ? (
        <p role="note" className="rounded-[12px] bg-[color:var(--fo-warning-tint)] p-3 text-sm leading-6 text-warning">{t('receiving.list.needsCost')}</p>
      ) : null}

      <div role="radiogroup" aria-label={t('receiving.list.filter')} className="grid grid-cols-3 gap-2">
        {FILTERS.map((value) => (
          <button
            key={value}
            type="button"
            role="radio"
            aria-checked={status === value}
            onClick={() => { setStatus(value); setPage(1); }}
            className={cn('min-h-12 rounded-lg border text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary', status === value ? 'border-primary bg-primary-soft text-primary' : 'border-[color:var(--fo-control)] text-text')}
          >
            {value === 'all' ? t('receiving.list.all') : t(`receiving.status.${value}`)}
          </button>
        ))}
      </div>

      {list.state.status === 'loading' ? <LoadingBlock rows={4} /> : null}
      {list.state.status === 'error' ? <ErrorState error={list.state.error} onRetry={list.reload} /> : null}
      {list.state.status === 'success' && list.state.data.rows.length === 0 ? <EmptyState title={t('receiving.list.empty')} body={t('receiving.list.emptyBody')} /> : null}
      {list.state.status === 'success' && list.state.data.rows.length > 0 ? (
        <>
          <ul className="space-y-2">{list.state.data.rows.map((row) => <Row key={row.id} row={row} />)}</ul>
          <nav aria-label={t('receiving.list.pagination')} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
            <SecondaryButton disabled={list.state.data.page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>{t('receiving.list.prev')}</SecondaryButton>
            <span className="num px-2 text-sm text-muted">{t('receiving.list.pageOf', { page: list.state.data.page, last: list.state.data.lastPage })}</span>
            <SecondaryButton disabled={list.state.data.page >= list.state.data.lastPage} onClick={() => setPage((value) => value + 1)}>{t('receiving.list.next')}</SecondaryButton>
          </nav>
        </>
      ) : null}
      <p className="text-xs leading-5 text-muted">{t('receiving.list.draftNote')}</p>
      <Badge tone="neutral">{station.name}</Badge>
    </>
  );
}

export function ReceivingListScreen() {
  const t = useTranslations('stationOps');
  const access = useReceivingAccess();
  return (
    <>
      <PageMasthead title={t('receiving.title')} subtitle={t('receiving.subtitle')} />
      <ScreenBody>
        {!access.view ? <ErrorState error={new StationOpsError('forbidden', 403)} /> : <StationGate>{(station) => <List station={station} />}</StationGate>}
      </ScreenBody>
    </>
  );
}
