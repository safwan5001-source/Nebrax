'use client';

import { useTranslations } from 'next-intl';
import { ReportCenter } from '@/modules/fuel-reports/report-center';
import { ReportViewer } from '@/modules/fuel-reports/report-viewer';
import { OPS_BASE } from '../nav';
import { PageMasthead, ScreenBody } from '../masthead';
import { StationGate } from '../station-gate';

/**
 * HORIZON-REPORTS — قسم «التقارير» داخل تطبيق المحطة: غلاف التطبيق نفسه (رأس كحلي + تنقل سفلي) فوق المكوّنات المشتركة مع أَوْج.
 * كل الروابط داخل `/fuel-stations/ops`؛ لا تحويل إلى أَوْج. التفويض والنطاق في الخادم.
 */
export const REPORTS_BASE = `${OPS_BASE}/reports`;

export function OpsReportsScreen() {
  const t = useTranslations('fuelReports');
  return (
    <>
      <PageMasthead title={t('title')} subtitle={t('subtitle')} />
      <ScreenBody>
        <ReportCenter basePath={REPORTS_BASE} />
      </ScreenBody>
    </>
  );
}

export function OpsReportScreen({ reportKey }: { reportKey: string }) {
  const t = useTranslations('fuelReports');
  return (
    <>
      <PageMasthead title={t('title')} backHref={REPORTS_BASE} backLabel={t('back')} />
      <ScreenBody>
        <StationGate>{(station) => <ReportViewer reportKey={reportKey} defaultStationId={station.id} />}</StationGate>
      </ScreenBody>
    </>
  );
}
