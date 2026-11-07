'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Coins, Plus, Search } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PageMasthead, ScreenBody } from '../masthead';
import { StationOpsError } from '../read-client';
import { EmptyState, ErrorState, LoadingBlock } from '../state-views';
import { StationGate } from '../station-gate';
import { SecondaryButton } from '../write-ui';
import { Badge, LinkCard } from '../admin/ui';
import { DocumentActions } from './document-actions';
import { listQuery, useDeliveryList, useReceivingAccess, type ListFilters, type StatusFilter } from './data';
import { Cost, Liters, RECEIVING_BASE, StatusBadge, VarianceText, internalRef, when } from './parts';
import type { Delivery } from './schemas';
import type { Station } from '../schemas';

const FILTERS: readonly StatusFilter[] = ['all', 'draft', 'approved'];

function Row({ row }: { row: Delivery }) {
  const t = useTranslations('stationOps');
  const locale = useLocale();
  const title = internalRef(row);
  const note = row.delivery_note_number && row.delivery_note_number.trim() !== '' ? `${t('receiving.field.deliveryNote')}: ${row.delivery_note_number}` : null;
  const hint = [note, row.supplier?.name, row.tank?.name].filter((part): part is string => !!part).join(' · ');
  return (
    <li className="space-y-1.5">
      <LinkCard href={`${RECEIVING_BASE}/${row.id}`} title={title} hint={hint || undefined} trailing={<StatusBadge status={row.status} />} />
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-2 pb-2 text-sm text-muted">
        <span>{t('receiving.list.received')}: <Liters ml={row.received_milliliters} /></span>
        <span><VarianceText ml={row.transit_variance_milliliters} /></span>
        {typeof row.received_total_cost_minor === 'number' ? <span>{t('receiving.list.cost')}: <Cost minor={row.received_total_cost_minor} /></span> : null}
        {row.status === 'draft' && row.cost_recorded === false ? <span data-row-cost-missing="" className="font-medium text-warning">{t('receiving.cost.missing')}</span> : null}
        {(row.attachments_count ?? 0) > 0 ? <span className="num">{t('receiving.attach.count', { count: row.attachments_count ?? 0 })}</span> : null}
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
  const [search, setSearch] = useState('');
  const [q, setQ] = useState('');
  const [cost, setCost] = useState<'' | 'missing' | 'recorded'>('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  useEffect(() => {
    const timer = window.setTimeout(() => { setQ(search); setPage(1); }, 300);
    return () => window.clearTimeout(timer);
  }, [search]);
  const invalidRange = from !== '' && to !== '' && to < from;
  const filters: ListFilters = { q, cost: cost || undefined, from: from || undefined, to: invalidRange ? undefined : (to || undefined) };
  const list = useDeliveryList(station, status, page, filters);

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
      ) : null}

      {access.seeCost || access.recordCost ? (
        <Link href={`${RECEIVING_BASE}/costs`} data-costs-link="" className="inline-flex min-h-12 w-full items-center justify-center gap-2 rounded-[13px] border border-[color:var(--fo-control)] bg-surface px-4 text-[15px] font-semibold text-text hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary">
          <Coins aria-hidden="true" className="h-5 w-5" strokeWidth={1.8} />{t('receiving.costs.open')}
        </Link>
      ) : null}

      <div className="relative">
        <label htmlFor="rcv-search" className="sr-only">{t('receiving.list.search')}</label>
        <Search aria-hidden="true" className="pointer-events-none absolute start-3 top-1/2 h-5 w-5 -translate-y-1/2 text-muted" strokeWidth={1.8} />
        <input id="rcv-search" type="search" value={search} onChange={(event) => setSearch(event.target.value)} placeholder={t('receiving.list.searchPlaceholder')} autoComplete="off" className="h-12 w-full rounded-[11px] border border-[color:var(--fo-control)] bg-surface ps-10 pe-3 text-base text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" />
      </div>

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

      <details className="rounded-[12px] border border-border bg-surface p-3" data-more-filters="">
        <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-text">{t('receiving.list.moreFilters')}</summary>
        <div className="mt-2 space-y-3">
          <div role="radiogroup" aria-label={t('receiving.list.costFilter')} className="grid grid-cols-3 gap-2">
            {(['', 'missing', 'recorded'] as const).map((value) => (
              <button key={value || 'any'} type="button" role="radio" aria-checked={cost === value} onClick={() => { setCost(value); setPage(1); }} className={cn('min-h-12 rounded-lg border px-1 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary', cost === value ? 'border-primary bg-primary-soft text-primary' : 'border-[color:var(--fo-control)] text-text')}>
                {value === '' ? t('receiving.list.all') : t(`receiving.list.cost_${value}`)}
              </button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2.5">
            <label className="block text-sm font-medium text-text">{t('receiving.list.from')}<input type="date" value={from} onChange={(event) => { setFrom(event.target.value); setPage(1); }} dir="ltr" className="mt-1.5 h-12 w-full rounded-[11px] border border-[color:var(--fo-control)] bg-surface px-3 text-base text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" /></label>
            <label className="block text-sm font-medium text-text">{t('receiving.list.to')}<input type="date" value={to} onChange={(event) => { setTo(event.target.value); setPage(1); }} dir="ltr" className="mt-1.5 h-12 w-full rounded-[11px] border border-[color:var(--fo-control)] bg-surface px-3 text-base text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" /></label>
          </div>
          {invalidRange ? <p role="alert" className="text-sm text-negative">{t('receiving.list.rangeInvalid')}</p> : null}
        </div>
      </details>

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
      <details className="rounded-[12px] border border-border bg-surface p-3" data-export-report="">
        <summary className="min-h-11 cursor-pointer py-2 text-sm font-semibold text-text">{t('receiving.docs.reportTitle')}</summary>
        <div className="mt-2">
          <p className="mb-3 text-xs leading-5 text-muted">{t('receiving.docs.reportHint')}</p>
          <DocumentActions target={{ kind: 'report', query: listQuery(station.id, status, filters) }} branchId={station.branch_id} />
        </div>
      </details>
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
