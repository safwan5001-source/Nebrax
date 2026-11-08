'use client';

import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ReportViewer } from '@/modules/fuel-reports/report-viewer';

export default function FuelStationsReportPage() {
  const t = useTranslations('fuelReports');
  const params = useParams<{ key: string }>();
  const key = Array.isArray(params.key) ? params.key[0] : params.key;
  return (
    <div className="space-y-5">
      <Link href="/fuel-stations/reports" className="inline-flex items-center gap-1 text-sm text-primary hover:underline"><ArrowRight className="h-4 w-4 rtl:rotate-0 ltr:rotate-180" strokeWidth={1.7} />{t('title')}</Link>
      <ReportViewer reportKey={key ?? ''} />
    </div>
  );
}
