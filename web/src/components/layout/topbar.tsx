'use client';

import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { LogOut, Search, Menu, Plus, Settings, ChevronDown, FilePlus, FilePlus2, UserPlus } from 'lucide-react';
import { Button } from '../ui/button';
import { Dropdown, DropdownItem } from '../ui/dropdown';
import { ThemeToggle } from './theme-toggle';
import { LangToggle } from './lang-toggle';
import { currentUser, logout } from '@/lib/auth';

export function Topbar({ onMenuClick }: { onMenuClick: () => void }) {
  const t = useTranslations('topbar');
  const router = useRouter();
  const user = currentUser();
  const initial = user?.name?.trim().charAt(0) || '؟';

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

      <div className="hidden h-9 items-center gap-2 rounded border border-border px-3 focus-within:ring-2 focus-within:ring-primary/40 sm:flex">
        <Search className="h-4 w-4 shrink-0 text-muted" strokeWidth={1.6} />
        <input
          placeholder={t('search')}
          className="w-40 bg-transparent text-sm text-text placeholder:text-muted focus:outline-none"
        />
      </div>

      <div className="ms-auto flex items-center gap-1">
        {/* قائمة الإنشاء السريع (+) */}
        <Dropdown
          align="end"
          menuLabel={t('create')}
          triggerClassName="h-9 w-9 justify-center text-text hover:bg-primary-soft hover:text-primary"
          trigger={<Plus className="h-4 w-4" strokeWidth={1.8} />}
        >
          <DropdownItem icon={FilePlus} href="/invoices/new">{t('new_invoice')}</DropdownItem>
          <DropdownItem icon={FilePlus2} href="/quotes/new">{t('new_quote')}</DropdownItem>
          <DropdownItem icon={UserPlus} href="/partners/new">{t('new_customer')}</DropdownItem>
        </Dropdown>

        <LangToggle />
        <ThemeToggle />

        {/* قائمة المستخدم */}
        <Dropdown
          align="end"
          menuLabel={t('account')}
          triggerClassName="gap-2 px-1.5 py-1 hover:bg-primary-soft"
          trigger={
            <>
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary">
                {initial}
              </span>
              <span className="hidden text-start leading-tight sm:block">
                <span className="block text-[11px] text-muted">{t('greeting')}</span>
                <span className="block max-w-32 truncate text-sm font-medium text-text">{user?.name ?? '—'}</span>
              </span>
              <ChevronDown className="hidden h-3.5 w-3.5 shrink-0 text-muted sm:block" strokeWidth={1.8} />
            </>
          }
        >
          <DropdownItem icon={Settings} href="/settings">{t('settings')}</DropdownItem>
          <DropdownItem icon={LogOut} tone="danger" onClick={handleLogout}>{t('logout')}</DropdownItem>
        </Dropdown>
      </div>
    </header>
  );
}
