'use client';

import { useParams } from 'next/navigation';
import { TankDetailScreen } from '@/modules/station-ops/tanks/tank-detail-screen';

export default function StationOpsTankDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  return <TankDetailScreen id={id ?? ''} />;
}
