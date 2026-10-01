'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { BranchScope, useBranchVersion } from '@/components/layout/branch-scope';
import { Sidebar } from '@/components/layout/sidebar';
import { Topbar } from '@/components/layout/topbar';
import { DemoBanner } from '@/components/layout/demo-banner';
import { AuthenticatedCompanyBrowserIdentity } from '@/components/layout/company-browser-identity';
import { currentUser, isAuthenticated } from '@/lib/auth';
import { applyAwjUiGate } from '@/lib/awj-ui-gate';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const branchVersion = useBranchVersion();

  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace('/login');
    } else if (currentUser()?.role === 'self_service') {
      // دور الخدمة الذاتية بلا صلاحياتٍ هنا أصلاً — بوابته المخصَّصة.
      router.replace('/me');
    } else {
      setReady(true);
    }
  }, [router]);

  // تبديل الفرع يُعيد الشريط لحالته الموسّعة — بلا تذكّر ولا تخزين محلي:
  // كل دخول جديد وكل تبديل فرع يبدأ من الافتراضي المتّفق عليه.
  useEffect(() => {
    if (branchVersion > 0) setCollapsed(false);
  }, [branchVersion]);

  // AWJ v3 feature gate (Horizon 1) — scoped to exactly this route group's mount
  // lifecycle. (app)/(commerce)/(pos)/(fuel) are mutually-exclusive sibling route
  // groups, so this never leaks the gate into Commerce, POS, Fuel, Platform, or auth
  // screens. Default is OFF everywhere (no silent production rollout) — see
  // src/lib/awj-ui-gate.ts for the explicit internal/dev/QA opt-in mechanism.
  useEffect(() => applyAwjUiGate(), []);

  const dismissSidebar = () => {
    // إعادة التركيز قبل إخفاء الدرج تمنع بقاء المؤشر داخل سطح غير مرئي.
    menuButtonRef.current?.focus();
    setSidebarOpen(false);
  };

  if (!ready) {
    return <div className="flex min-h-screen items-center justify-center bg-background text-muted">…</div>;
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <AuthenticatedCompanyBrowserIdentity />
      <DemoBanner />
      <div className="flex min-h-0 flex-1">
        <Sidebar
          open={sidebarOpen}
          onClose={() => setSidebarOpen(false)}
          onDismiss={dismissSidebar}
          collapsed={collapsed}
          onToggleCollapse={() => setCollapsed((c) => !c)}
        />
        <div className="flex min-w-0 flex-1 flex-col">
          <Topbar onMenuClick={() => setSidebarOpen(true)} menuButtonRef={menuButtonRef} />
          <main className="min-w-0 flex-1 overflow-auto p-4 sm:p-6">
            {/* تبديل الفرع يُعيد جلب بيانات الصفحة فوراً — بلا إعادة تحميل. */}
            <BranchScope>{children}</BranchScope>
          </main>
        </div>
      </div>
    </div>
  );
}
