'use client';

import { useParams } from 'next/navigation';
import { ShiftDetailScreen } from '@/modules/station-ops/shift-detail-screen';

export default function StationOpsShiftDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  return <ShiftDetailScreen shiftId={id ?? ''} />;
}
