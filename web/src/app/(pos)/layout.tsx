'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { isAuthenticated } from '@/lib/auth';

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

  if (!ready) {
    return <div className="grid h-screen place-items-center bg-background text-muted">…</div>;
  }

  return <div className="h-screen w-full overflow-hidden bg-background">{children}</div>;
}
