'use client';

import { useTranslations } from 'next-intl';
import { RefreshCw } from 'lucide-react';
import { PageMasthead, ScreenBody } from '../masthead';
import { EmptyState, ErrorState, LoadingBlock } from '../state-views';
import { StationGate } from '../station-gate';
import type { Station } from '../schemas';
import { SecondaryButton } from '../write-ui';
import { useTankLevels } from './data';
import { TankCard } from './tank-card';

function List({ station }: { station: Station }) {
  const t = useTranslations('stationOps');
  const levels = useTankLevels(station);
  const { state } = levels;
  const review = state.status === 'success' ? state.data.filter((row) => row.level.needs_review).length : 0;

  return (
    <>
      {state.status === 'loading' ? <LoadingBlock rows={3} /> : null}
      {state.status === 'error' ? <ErrorState error={state.error} onRetry={levels.reload} /> : null}
      {state.status === 'success' && state.data.length === 0 ? <EmptyState title={t('tanks.list.empty')} body={t('tanks.list.emptyBody')} /> : null}
      {state.status === 'success' && state.data.length > 0 ? (
        <>
          <p
            role="status"
            data-review-summary={review > 0 ? 'review' : 'ok'}
            className={`rounded-[12px] px-3.5 py-3 text-sm font-medium ${review > 0 ? 'bg-[color:var(--fo-warning-tint)] text-warning' : 'bg-primary-soft text-text'}`}
          >
            {review > 0 ? t('tanks.list.summaryReview', { count: review }) : t('tanks.list.summaryOk')}
          </p>
          <ul className="space-y-3">
            {state.data.map((row) => <TankCard key={row.tank.id} row={row} timeZone={station.timezone} />)}
          </ul>
          <SecondaryButton onClick={levels.reload} data-refresh="">
            <RefreshCw aria-hidden="true" className="h-4 w-4" strokeWidth={1.8} />
            {t('tanks.stale.refresh')}
          </SecondaryButton>
          <p className="text-xs leading-5 text-muted">{t('tanks.list.measuredNote')}</p>
        </>
      ) : null}
    </>
  );
}

export function TanksScreen() {
  const t = useTranslations('stationOps');
  return (
    <>
      <PageMasthead title={t('tanks.title')} subtitle={t('tanks.subtitle')} />
      <ScreenBody>
        <StationGate>{(station) => <List station={station} />}</StationGate>
      </ScreenBody>
    </>
  );
}
