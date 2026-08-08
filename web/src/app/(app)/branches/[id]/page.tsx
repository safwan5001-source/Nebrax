'use client';

import { useParams } from 'next/navigation';
import { BranchForm } from '@/components/branches/branch-form';

export default function EditBranchPage() {
  const { id } = useParams<{ id: string }>();
  return <BranchForm branchId={id} />;
}
