'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { LogOut, Search, Menu } from 'lucide-react';
import { Button } from '../ui/button';
import { ThemeToggle } from './theme-toggle';
import { LangToggle } from './lang-toggle';
import { currentUser, logout } from '@/lib/auth';

export function Topbar({ onMenuClick }: { onMenuClick: () => void }) {
  const t = useTranslations('topbar');
  const router = useRouter();
  const user = currentUser();

  async function handleLogout() {
    await logout();
    router.replace('/login');
  }

  return (
    <header className="no-print flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
      <Button
        variant="ghost"
        size="icon"
        className="lg:hidden"
        aria-label={t('menu')}
        onClick={onMenuClick}
      >
        <Menu className="h-5 w-5" strokeWidth={1.7} />
      </Button>

      <div className="hidden items-center gap-2 rounded border border-border px-2.5 py-1.5 sm:flex">
        <Search className="h-4 w-4 text-muted" strokeWidth={1.6} />
        <input
          placeholder={t('search')}
          className="w-40 bg-transparent text-sm text-text placeholder:text-muted focus:outline-none"
        />
      </div>

      <div className="ms-auto flex items-center gap-1">
        <div className="mx-2 hidden text-sm sm:block">
          <span className="text-muted">{t('greeting')}، </span>
          <span className="font-medium text-text">{user?.name ?? '—'}</span>
        </div>
        <LangToggle />
        <ThemeToggle />
        <Button variant="ghost" size="icon" aria-label={t('logout')} onClick={handleLogout}>
          <LogOut className="h-4 w-4" strokeWidth={1.7} />
        </Button>
      </div>
    </header>
  );
}
