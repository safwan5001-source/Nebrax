'use client';

import { useParams } from 'next/navigation';
import { FillDetailScreen } from '@/modules/fuel-tankers/fills/fill-detail-screen';

export default function TankerFillDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  return <FillDetailScreen fillId={id ?? ''} />;
}
