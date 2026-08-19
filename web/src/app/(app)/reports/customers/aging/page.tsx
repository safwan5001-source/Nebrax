'use client';

import { useTranslations } from 'next-intl';
import { ReportsWorkspace } from '@/components/reports/reports-workspace';

export default function CustomerAgingReportPage() {
  const t = useTranslations('reports.catalog');

  return (
    <ReportsWorkspace
      initialTab="aging"
      allowedTabs={['aging']}
      fixedAgingType="receivable"
      heading={t('reports.customerAging.title')}
    />
  );
}
