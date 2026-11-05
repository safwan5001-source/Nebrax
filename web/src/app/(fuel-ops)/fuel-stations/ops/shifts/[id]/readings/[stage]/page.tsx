'use client';

import { useParams } from 'next/navigation';
import { ReadingsEntryScreen } from '@/modules/station-ops/readings-entry-screen';

export default function StationOpsReadingsPage() {
  const params = useParams<{ id: string; stage: string }>();
  const first = (value: string | string[] | undefined) => (Array.isArray(value) ? value[0] : value) ?? '';
  return <ReadingsEntryScreen shiftId={first(params.id)} stage={first(params.stage)} />;
}
