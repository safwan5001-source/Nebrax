import { notFound } from 'next/navigation';
import { PurchasesReportsWorkspace, type PurchaseReportView } from '@/components/reports/purchases-reports-workspace';

const REPORTS: Record<string, PurchaseReportView> = {
  'by-period': 'period',
  'by-supplier': 'supplier',
  'by-product': 'product',
  'by-classification': 'classification',
  'by-employee': 'employee',
  balances: 'balances',
  payments: 'payments',
};

export default async function PurchaseReportPage({ params }: { params: Promise<{ report: string }> }) {
  const { report } = await params;
  const view = REPORTS[report];
  if (!view) notFound();

  return <PurchasesReportsWorkspace view={view} />;
}
