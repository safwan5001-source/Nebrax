'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { FuelWorkspaceShell } from '@/components/fuel-stations/fuel-workspace-shell';
import { currentUser, isAuthenticated } from '@/lib/auth';

/**
 * Fuel Stations route group مستقل عن `(app)`: لا Sidebar ولا Topbar عامين.
 * يستمر الاعتماد على مصادقة الواجهة والحماية الخادمية القائمة دون أي تغيير للعقود.
 */
export default function FuelLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace('/login');
    } else if (currentUser()?.role === 'self_service') {
      router.replace('/me');
    } else {
      setReady(true);
    }
  }, [router]);

  if (!ready) {
    return <div className="grid h-screen place-items-center bg-background text-muted [height:100dvh]">…</div>;
  }

  return <FuelWorkspaceShell>{children}</FuelWorkspaceShell>;
}
