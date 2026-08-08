'use client';

import { useParams } from 'next/navigation';
import { WarehouseForm } from '@/components/warehouses/warehouse-form';

export default function EditWarehousePage() {
  const { id } = useParams<{ id: string }>();
  return <WarehouseForm warehouseId={id} />;
}
