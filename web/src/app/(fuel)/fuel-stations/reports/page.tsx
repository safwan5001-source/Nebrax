'use client';

import Link from 'next/link';
import { ArrowRight } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { ReportCenter } from '@/modules/fuel-reports/report-center';

/** أَوْج ← محطات الوقود ← التقارير: المحرك والمكوّنات نفسها التي يستعملها تطبيق المحطة (نتائج متطابقة). */
export default function FuelStationsReportsPage() {
  const t = useTranslations('fuelReports');
  return (
    <div className="space-y-5">
      <div>
        <Link href="/fuel-stations" className="inline-flex items-center gap-1 text-sm text-primary hover:underline"><ArrowRight className="h-4 w-4 rtl:rotate-0 ltr:rotate-180" strokeWidth={1.7} />{t('backWorkspace')}</Link>
        <h1 className="mt-2 text-xl font-semibold text-text">{t('title')}</h1>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted">{t('subtitle')}</p>
      </div>
      <ReportCenter basePath="/fuel-stations/reports" />
    </div>
  );
}
