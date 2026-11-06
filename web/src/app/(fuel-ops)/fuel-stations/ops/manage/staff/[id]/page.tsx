'use client';

import { useParams } from 'next/navigation';
import { StaffEditorScreen } from '@/modules/station-ops/admin/staff-editor-screen';

export default function StationOpsStaffEditorPage() {
  const params = useParams<{ id: string }>();
  const id = Array.isArray(params.id) ? params.id[0] : params.id;
  return <StaffEditorScreen id={id ?? ''} />;
}
