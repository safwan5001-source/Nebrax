import { notFound } from 'next/navigation';
import { InventoryReportsWorkspace, type InventoryReportView } from '@/components/reports/inventory-reports-workspace';

const REPORTS: Record<string, InventoryReportView> = {
  value: 'value',
  warehouses: 'warehouses',
  movements: 'movements',
  operations: 'operations',
  stocktakes: 'stocktakes',
};

export default async function InventoryReportPage({ params }: { params: Promise<{ report: string }> }) {
  const { report } = await params;
  const view = REPORTS[report];
  if (!view) notFound();

  return <InventoryReportsWorkspace view={view} />;
}
