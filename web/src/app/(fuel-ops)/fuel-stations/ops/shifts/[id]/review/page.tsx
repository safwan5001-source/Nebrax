'use client';

import { useParams } from 'next/navigation';
import { ShiftReviewScreen } from '@/modules/station-ops/review-screen';

export default function StationOpsShiftReviewPage() {
  const params = useParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  return <ShiftReviewScreen shiftId={id ?? ''} />;
}
