'use client';

import { useState } from 'react';
import { useTranslations } from 'next-intl';
import { useShiftHistory, type ShiftFilter } from './data';
import { ShiftCard } from './shift-card';
import { PageMasthead, ScreenBody } from './masthead';
import { StationGate } from './station-gate';
import { EmptyState, ErrorState, LoadingBlock } from './state-views';
import type { Station } from './schemas';
import { cn } from '@/lib/utils';

const FILTERS: readonly ShiftFilter[] = ['all', 'open', 'closed', 'approved'];

function Content({ station }: { station: Station }) {
  const t = useTranslations('stationOps');
  const [filter, setFilter] = useState<ShiftFilter>('all');
  const history = useShiftHistory(station, filter);

  return (
    <>
      <div role="group" aria-label={t('shifts.filterLabel')} className="flex flex-wrap gap-2">
        {FILTERS.map((value) => (
          <button
            key={value}
            type="button"
            aria-pressed={filter === value}
            onClick={() => setFilter(value)}
            className={cn(
              'min-h-11 rounded-full border px-4 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
              filter === value ? 'border-primary bg-primary-soft text-primary' : 'border-[color:var(--fo-control)] bg-surface text-text',
            )}
          >
            {t(`shifts.filter.${value}`)}
          </button>
        ))}
      </div>

      {filter === 'closed' ? <p className="text-sm text-muted">{t('shifts.closedHint')}</p> : null}

      {!history.allowed ? (
        <EmptyState title={t('shift.noPermission.title')} body={t('shift.noPermission.body')} />
      ) : history.state.status === 'loading' ? (
        <LoadingBlock rows={3} />
      ) : history.state.status === 'error' ? (
        <ErrorState error={history.state.error} onRetry={history.reload} />
      ) : history.state.data.shifts.length === 0 ? (
        <EmptyState title={t('shifts.empty.title')} body={t('shifts.empty.body')} />
      ) : (
        <>
          <ul className="space-y-3">
            {history.state.data.shifts.map((shift) => (
              <li key={shift.id}><ShiftCard shift={shift} timeZone={station.timezone} /></li>
            ))}
          </ul>
          {history.state.data.hasMore ? (
            <div className="flex flex-col items-center gap-2">
              {history.loadMoreFailed ? <p role="alert" className="text-sm text-warning">{t('shifts.loadMoreFailed')}</p> : null}
              <button
                type="button"
                onClick={history.loadMore}
                disabled={history.loadingMore}
                className="min-h-12 w-full rounded-lg border border-[color:var(--fo-control)] bg-surface px-4 text-base font-medium text-text hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary disabled:opacity-60"
              >
                {history.loadingMore ? t('loading') : t('shifts.loadMore')}
              </button>
            </div>
          ) : (
            <p className="text-center text-sm text-muted">{t('shifts.endOfList')}</p>
          )}
        </>
      )}

      <p className="rounded-[14px] border border-dashed border-border p-4 text-sm leading-6 text-muted">{t('shifts.readOnlyNote')}</p>
    </>
  );
}

export function ShiftsScreen() {
  const t = useTranslations('stationOps');
  return (
    <>
      <PageMasthead title={t('shifts.title')} subtitle={t('shifts.subtitle')} />
      <ScreenBody>
        <StationGate>{(station) => <Content station={station} />}</StationGate>
      </ScreenBody>
    </>
  );
}
