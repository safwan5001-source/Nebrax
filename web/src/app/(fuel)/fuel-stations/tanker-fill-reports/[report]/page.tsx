'use client';

import { notFound, useParams } from 'next/navigation';
import { ReportsScreen } from '@/modules/fuel-tankers/reports/reports-screen';
import { isReportKey } from '@/modules/fuel-tankers/reports/routes';

export default function TankerFillReportPage() {
  const params = useParams<{ report: string }>();
  const key = Array.isArray(params.report) ? params.report[0] : params.report;
  if (!isReportKey(key) || key === 'fills') notFound();
  return <ReportsScreen key={key} reportKey={key} />;
}
