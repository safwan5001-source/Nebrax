'use client';

import { useParams } from 'next/navigation';
import { OpsReportScreen } from '@/modules/station-ops/reports/reports-screens';

export default function StationOpsReportPage() {
  const params = useParams<{ key: string }>();
  const key = Array.isArray(params.key) ? params.key[0] : params.key;
  return <OpsReportScreen reportKey={key ?? ''} />;
}
