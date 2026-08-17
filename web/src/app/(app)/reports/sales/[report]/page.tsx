'use client';

import { notFound, useParams } from 'next/navigation';
import { SalesReportsWorkspace, type SalesReportView } from '@/components/reports/sales-reports-workspace';

const REPORTS: Record<string, SalesReportView> = {
  'by-period': 'period',
  'by-customer': 'customer',
  'by-product': 'product',
  'by-salesperson': 'salesperson',
  profitability: 'profit',
  payments: 'payments',
};

export default function SalesReportPage() {
  const params = useParams<{ report: string }>();
  const view = REPORTS[params.report];

  if (!view) notFound();

  return <SalesReportsWorkspace view={view} />;
}
