'use client';

import { Fragment, type ReactNode } from 'react';
import { useTranslations } from 'next-intl';
import { useStationOps } from './context';
import type { Station } from './schemas';
import { EmptyState, ErrorState, LoadingBlock } from './state-views';
import { StationOpsError } from './read-client';

/**
 * بوابة المحطة: تعرض حالة التحميل/الخطأ/عدم الصلاحية/عدم وجود محطات مصرّح بها، ولا تُنشئ أي محطة بديلة.
 * الأبناء يُركَّبون تحت `key = station.id` فتسقط حالتهم المحلية كلها عند تبديل المحطة.
 */
export function StationGate({ children }: { children: (station: Station) => ReactNode }) {
  const t = useTranslations('stationOps');
  const { canViewStations, stations, selectedStation, reloadStations } = useStationOps();

  if (!canViewStations) return <ErrorState error={new StationOpsError('forbidden', 403)} />;
  if (stations.status === 'loading') return <LoadingBlock label={t('loadingStations')} />;
  if (stations.status === 'error') return <ErrorState error={stations.error} onRetry={reloadStations} />;
  if (!selectedStation) return <EmptyState title={t('noStations.title')} body={t('noStations.body')} />;

  return <Fragment key={selectedStation.id}>{children(selectedStation)}</Fragment>;
}
