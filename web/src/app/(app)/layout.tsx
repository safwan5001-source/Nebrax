'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import { BranchScope, useBranchVersion } from '@/components/layout/branch-scope';
import { Sidebar } from '@/components/layout/sidebar';
import { Topbar } from '@/components/layout/topbar';
import { DemoBanner } from '@/components/layout/demo-banner';
import { AuthenticatedCompanyBrowserIdentity } from '@/components/layout/company-browser-identity';
import { currentUser, isAuthenticated } from '@/lib/auth';
import { usePermissionRefresh } from '@/lib/use-can';
import { applyAwjUiGate } from '@/lib/awj-ui-gate';
import { CardTitleLevel } from '@/components/ui/card';
import { AssistantPanel } from '@/components/intelligence/assistant-panel';
import { IntelligenceProvider } from '@/modules/intelligence/store';

export default function AppLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const [ready, setReady] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const branchVersion = useBranchVersion();
  const t = useTranslations('topbar');
  const locale = useLocale() === 'en' ? 'en' : 'ar';

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

  // الصلاحيات المخزَّنة تُعاد قراءتها من `/me` عند التركيب وعودة التركيز (تغيير دور أثناء الجلسة).
  usePermissionRefresh(ready);

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
    <IntelligenceProvider locale={locale}>
    <div data-posture="ledger" className="flex min-h-screen flex-col bg-background">
      {/* أول عنصر قابل للتركيز: يتخطّى الشريط الجانبي والعلوي (~40 ضغطة Tab) إلى المحتوى (ERP-UX-006). */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:fixed focus:start-3 focus:top-3 focus:z-[200] focus:rounded focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary focus:shadow-md focus:outline-none focus:ring-2 focus:ring-primary"
      >
        {t('skip_to_content')}
      </a>
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
          <Topbar onMenuClick={() => setSidebarOpen(true)} menuButtonRef={menuButtonRef} menuExpanded={sidebarOpen} />
          <main id="main-content" tabIndex={-1} className="min-w-0 flex-1 overflow-auto p-4 outline-none sm:p-6">
            {/* تبديل الفرع يُعيد جلب بيانات الصفحة فوراً — بلا إعادة تحميل. */}
            <CardTitleLevel level="h2">
              <BranchScope>{children}</BranchScope>
            </CardTitleLevel>
          </main>
        </div>
      </div>
      {/* مساعد أَوْج: حالته في الذاكرة فقط؛ لا طلب قبل فتح اللوحة أو الدخول إلى المساحة. */}
      <AssistantPanel />
    </div>
    </IntelligenceProvider>
  );
}
