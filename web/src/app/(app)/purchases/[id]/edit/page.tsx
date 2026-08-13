'use client';

import { useParams } from 'next/navigation';
import { PurchaseForm } from '@/components/purchases/purchase-form';

export default function EditPurchasePage() {
  const { id } = useParams<{ id: string }>();

  return <PurchaseForm editId={id} />;
}
