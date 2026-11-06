'use client';

import { useParams } from 'next/navigation';
import { ReceivingDetailScreen } from '@/modules/station-ops/receiving/receiving-detail-screen';

export default function StationOpsReceivingDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  return <ReceivingDetailScreen id={id ?? ''} />;
}
