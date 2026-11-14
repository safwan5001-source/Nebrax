'use client';

import { useParams } from 'next/navigation';
import { TankerFillDetailScreen } from '@/modules/station-ops/tanker-fill/detail-screen';

export default function StationOpsTankerFillDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  return <TankerFillDetailScreen id={id ?? ''} />;
}
