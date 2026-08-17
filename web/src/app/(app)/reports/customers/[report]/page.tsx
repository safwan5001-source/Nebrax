import { notFound } from 'next/navigation';
import { CustomersReportsWorkspace, type CustomerReportView } from '@/components/reports/customers-reports-workspace';

const REPORTS: Record<string, CustomerReportView> = {
  sales: 'sales',
  balances: 'balances',
  payments: 'payments',
  appointments: 'appointments',
};

export default async function CustomerReportPage({ params }: { params: Promise<{ report: string }> }) {
  const { report } = await params;
  const view = REPORTS[report];
  if (!view) notFound();

  return <CustomersReportsWorkspace view={view} />;
}
