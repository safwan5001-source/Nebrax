'use client';

import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { LogOut } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { LangToggle } from '@/components/layout/lang-toggle';
import { CompanyLogoMark } from '@/components/layout/company-logo-mark';
import { useCompany } from '@/lib/company';
import { currentUser, isAuthenticated, logout } from '@/lib/auth';

/**
 * قشرة بوابة الخدمة الذاتية — عمداً بلا شريط جانبي: هذا الدور لا يملك
 * صلاحياتٍ خارج `/me/*` أصلاً، فقشرة الإدارة الكاملة (٨ مجموعات) مضلِّلة هنا.
 */
export default function SelfServiceLayout({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const t = useTranslations('selfService');
  const company = useCompany();
  const [ready, setReady] = useState(false);
  const [name, setName] = useState('');

  useEffect(() => {
    if (!isAuthenticated()) {
      router.replace('/login');
      return;
    }
    setName(currentUser()?.name ?? '');
    setReady(true);
  }, [router]);

  async function handleLogout() {
    await logout();
    router.replace('/login');
  }

  if (!ready) {
    return <div className="flex min-h-screen items-center justify-center bg-background text-muted">…</div>;
  }

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="no-print flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
        <CompanyLogoMark logo={company?.logo} name={company?.name} />
        <span className="truncate text-sm font-semibold text-text">{company?.name ?? t('portal_title')}</span>
        <div className="flex flex-1 items-center justify-end gap-2">
          <span className="hidden text-sm text-muted sm:inline">{name}</span>
          <LangToggle />
          <ThemeToggle />
          <Button variant="ghost" size="icon" aria-label={t('logout')} onClick={handleLogout}>
            <LogOut className="h-[18px] w-[18px]" strokeWidth={1.7} />
          </Button>
        </div>
      </header>
      <main className="min-w-0 flex-1 overflow-auto p-4 sm:p-6">
        <div className="mx-auto w-full max-w-3xl">{children}</div>
      </main>
    </div>
  );
}
