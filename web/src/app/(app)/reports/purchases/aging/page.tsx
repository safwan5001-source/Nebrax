'use client';

import { useTranslations } from 'next-intl';
import { ReportsWorkspace } from '@/components/reports/reports-workspace';

export default function SupplierAgingReportPage() {
  const t = useTranslations('reports.catalog');

  return (
    <ReportsWorkspace
      initialTab="aging"
      allowedTabs={['aging']}
      fixedAgingType="payable"
      heading={t('reports.supplierAging.title')}
    />
  );
}
