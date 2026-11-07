'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isAuthenticated } from '@/lib/auth';
import { applyAwjUiGate } from '@/lib/awj-ui-gate';
import { AuthenticatedCompanyBrowserIdentity } from '@/components/layout/company-browser-identity';

/**
 * تخطيط مستقل لنقطة البيع — يملأ الشاشة بالكامل بلا شريط جانبي ولا هيدر.
 * لا يرث تخطيط لوحة التحكم (app)؛ يرث فقط المزوّدات من الجذر (next-intl/theme/toast).
 */
export default function PosLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);

  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace('/login');
    } else {
      setReady(true);
    }
  }, [router]);

  // AWJ v3 gate (opt-in only, see awj-ui-gate.ts): (pos) is a sibling route group of (app),
  // so the gate must be applied here too for the Floor posture to exist. Default stays OFF.
  useEffect(() => applyAwjUiGate(), []);

  if (!ready) {
    return <div className="grid h-screen place-items-center bg-background text-muted">…</div>;
  }

  return (
    <div data-posture="floor" className="h-screen w-full overflow-hidden bg-background [height:100dvh]">
      <AuthenticatedCompanyBrowserIdentity />
      {children}
    </div>
  );
}
