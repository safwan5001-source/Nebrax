'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { PageMasthead, ScreenBody } from '../masthead';
import { StationOpsError } from '../read-client';
import { EmptyState, ErrorState, LoadingBlock } from '../state-views';
import { StationGate } from '../station-gate';
import { SecondaryButton } from '../write-ui';
import { Badge } from '../admin/ui';
import { CostCard } from './cost-card';
import { useDeliveryList, useReceivingAccess } from './data';
import { Liters, RECEIVING_BASE, deliveryTitle, when } from './parts';
import type { Delivery } from './schemas';
import type { Station } from '../schemas';
import Link from 'next/link';

/**
 * FUEL-B5.1 — «بانتظار التكلفة»: مسودات الاستلام التي لم تُسجَّل تكلفتها بعد، مع إدخال التكلفة في مكانه (للمخوَّل). الخادم يحدد ما يُسجَّل ومن يسجّل؛
 * ولا يظهر مبلغ لغير من يرى التكلفة. السجل يختفي من القائمة فور تسجيل تكلفته (إعادة القراءة من الخادم، لا تخمين).
 */
function Pending({ station }: { station: Station }) {
  const t = useTranslations('stationOps');
  const locale = useLocale();
  const access = useReceivingAccess();
  const [page, setPage] = useState(1);
  const list = useDeliveryList(station, 'draft', page, { cost: 'missing' });

  return (
    <>
      <p className="text-sm leading-6 text-muted">{access.recordCost ? t('receiving.costs.intro') : t('receiving.costs.introReadonly')}</p>
      {list.state.status === 'loading' ? <LoadingBlock rows={3} /> : null}
      {list.state.status === 'error' ? <ErrorState error={list.state.error} onRetry={list.reload} /> : null}
      {list.state.status === 'success' && list.state.data.rows.length === 0 ? <EmptyState title={t('receiving.costs.empty')} body={t('receiving.costs.emptyBody')} /> : null}
      {list.state.status === 'success' ? (
        <>
          <ul className="space-y-3" data-pending-costs="">
            {list.state.data.rows.map((row: Delivery) => (
              <li key={row.id} className="space-y-3 rounded-[14px] border border-border bg-surface p-4" data-pending-id={row.id}>
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link href={`${RECEIVING_BASE}/${row.id}`} className="flex min-h-11 items-center truncate text-[15px] font-semibold text-text underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary" dir="auto">{deliveryTitle(row, t('receiving.untitled'))}</Link>
                    <p className="truncate text-sm text-muted" dir="auto">{[row.supplier?.name, row.tank?.name].filter(Boolean).join(' · ')}</p>
                  </div>
                  <Badge tone="warning">{t('receiving.cost.missing')}</Badge>
                </div>
                <p className="text-sm text-muted">{t('receiving.field.received')}: <Liters ml={row.received_milliliters} /> · <span className="num">{when(row.received_at ?? row.created_at, locale)}</span></p>
                <CostCard delivery={row} branchId={station.branch_id} compact onSaved={() => list.reload()} />
              </li>
            ))}
          </ul>
          {list.state.data.lastPage > 1 ? (
            <nav aria-label={t('receiving.list.pagination')} className="grid grid-cols-[1fr_auto_1fr] items-center gap-2">
              <SecondaryButton disabled={list.state.data.page <= 1} onClick={() => setPage((value) => Math.max(1, value - 1))}>{t('receiving.list.prev')}</SecondaryButton>
              <span className="num px-2 text-sm text-muted">{t('receiving.list.pageOf', { page: list.state.data.page, last: list.state.data.lastPage })}</span>
              <SecondaryButton disabled={list.state.data.page >= list.state.data.lastPage} onClick={() => setPage((value) => value + 1)}>{t('receiving.list.next')}</SecondaryButton>
            </nav>
          ) : null}
        </>
      ) : null}
    </>
  );
}

export function ReceivingCostsScreen() {
  const t = useTranslations('stationOps');
  const access = useReceivingAccess();
  return (
    <>
      <PageMasthead title={t('receiving.costs.title')} subtitle={t('receiving.costs.subtitle')} backHref={RECEIVING_BASE} backLabel={t('receiving.title')} />
      <ScreenBody>
        {!access.view ? <ErrorState error={new StationOpsError('forbidden', 403)} /> : <StationGate>{(station) => <Pending station={station} />}</StationGate>}
      </ScreenBody>
    </>
  );
}
