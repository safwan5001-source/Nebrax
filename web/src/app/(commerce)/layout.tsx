'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { CommerceWorkspaceShell } from '@/components/commerce-workspace/commerce-workspace-shell';
import { currentUser, isAuthenticated } from '@/lib/auth';
import { CommerceStoreProvider } from '@/modules/commerce-workspace/store-context';

/**
 * Commerce Workspace is a dedicated ERP shell, following the Fuel Stations
 * pattern: it does not inherit the global AWJ sidebar. Auth and tenant
 * context remain the same session already established by AWJ.
 */
export default function CommerceLayout({ children }: { children: React.ReactNode }) {
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

  return (
    <CommerceStoreProvider>
      <CommerceWorkspaceShell>{children}</CommerceWorkspaceShell>
    </CommerceStoreProvider>
  );
}
