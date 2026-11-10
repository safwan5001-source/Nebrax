'use client';

import { useParams } from 'next/navigation';
import { OwnerDetailScreen } from '@/modules/fuel-tankers/owner-detail-screen';

export default function TankerOwnerDetailPage() {
  const params = useParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  return <OwnerDetailScreen ownerId={id ?? ''} />;
}
