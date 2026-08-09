'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BranchScope, useBranchVersion } from '@/components/layout/branch-scope';
import { Sidebar } from '@/components/layout/sidebar';
import { Topbar } from '@/components/layout/topbar';
import { DemoBanner } from '@/components/layout/demo-banner';
import { isAuthenticated } from '@/lib/auth';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const branchVersion = useBranchVersion();

  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace('/login');
    } else {
      setReady(true);
    }
  }, [router]);

  // تبديل الفرع يُعيد الشريط لحالته الموسّعة — بلا تذكّر ولا تخزين محلي:
  // كل دخول جديد وكل تبديل فرع يبدأ من الافتراضي المتّفق عليه.
  useEffect(() => {
    if (branchVersion > 0) setCollapsed(false);
  }, [branchVersion]);

  if (!ready) {
    return <div className="flex min-h-screen items-center justify-center bg-background text-muted">…</div>;
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <DemoBanner />
      <div className="flex min-h-0 flex-1">
        <Sidebar
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((c) => !c)}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar onMenuClick={() => setSidebarOpen(true)} />
          <main className="min-w-0 flex-1 overflow-auto p-4 sm:p-6">
            {/* تبديل الفرع يُعيد جلب بيانات الصفحة فوراً — بلا إعادة تحميل. */}
            <BranchScope>{children}</BranchScope>
          </main>
        </div>
      </div>
    </div>
  );
}
