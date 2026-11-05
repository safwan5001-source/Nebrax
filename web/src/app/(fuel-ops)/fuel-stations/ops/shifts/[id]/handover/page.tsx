'use client';

import { useParams } from 'next/navigation';
import { HandoverScreen } from '@/modules/station-ops/handover-screen';

export default function StationOpsHandoverPage() {
  const params = useParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  return <HandoverScreen shiftId={id ?? ''} />;
}
