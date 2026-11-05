'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { useRouter } from 'next/navigation';
import { AuthenticatedCompanyBrowserIdentity } from '@/components/layout/company-browser-identity';
import { currentUser, isAuthenticated } from '@/lib/auth';
import { StationOpsShell } from './shell';

/**
 * حارس الدخول لمساحة تشغيل المحطات — نفس سلوك `(fuel)/layout.tsx`: بلا جلسة ⇒ /login، والخدمة الذاتية ⇒ /me.
 * هذا تنقّل عرض فقط؛ التفويض الحقيقي في كل طلب على الخادم (RBAC + نطاق المستأجر/الفرع/المحطة).
 */
export function StationOpsGuard({ children }: { children: ReactNode }) {
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
    <>
      <AuthenticatedCompanyBrowserIdentity />
      <StationOpsShell>{children}</StationOpsShell>
    </>
  );
}
