'use client';

import { useRouter } from 'next/navigation';
import type { RefObject } from 'react';
import { useTranslations } from 'next-intl';
import { LogOut, Search, Menu, Plus, Settings, ChevronDown, FilePlus, FilePlus2, UserPlus, Building2, Check } from 'lucide-react';
import { Button } from '../ui/button';
import { Dropdown, DropdownItem } from '../ui/dropdown';
import { ThemeToggle } from './theme-toggle';
import { LangToggle } from './lang-toggle';
import { NotificationBell } from './notification-bell';
import { CompanyLogoMark } from '@/components/layout/company-logo-mark';
import { useCompany } from '@/lib/company';
import { currentUser, logout } from '@/lib/auth';
import { useBranches } from '@/lib/branch';

export function Topbar({
  onMenuClick,
  menuButtonRef,
}: {
  onMenuClick: () => void;
  menuButtonRef: RefObject<HTMLButtonElement>;
}) {
  const t = useTranslations('topbar');
  const tb = useTranslations('branches');
  const router = useRouter();
  const user = currentUser();
  const initial = user?.name?.trim().charAt(0) || '؟';
  const company = useCompany();
  // مبدّل الفرع النشط — تبديل سريع فقط (الإدارة في عنصر «الفروع» بالشريط الجانبي).
  const { branches, active, activeId, setActiveBranchId } = useBranches();

  async function handleLogout() {
    await logout();
    router.replace('/login');
  }

  return (
    <header className="no-print flex h-14 shrink-0 items-center gap-3 border-b border-border bg-surface px-4">
      <Button
        variant="ghost"
        size="icon"
        className="h-11 w-11 lg:hidden"
        aria-label={t('menu')}
        onClick={onMenuClick}
        ref={menuButtonRef}
      >
        <Menu className="h-5 w-5" strokeWidth={1.7} />
      </Button>

      {/* علامة الشركة — على الجوال وحده: الشاشة الواسعة تعرضها في ترويسة
          الشريط الجانبي، وتكرارها في الشريطين ضجيجٌ بلا فائدة. */}
      <CompanyLogoMark logo={company?.logo} name={company?.name} size="sm" className="lg:hidden" />

      <div className="hidden h-12 items-center gap-2 rounded border border-border px-3 focus-within:ring-2 focus-within:ring-primary/40 sm:flex">
        <Search className="h-4 w-4 shrink-0 text-muted" strokeWidth={1.6} />
        <input
          placeholder={t('search')}
          className="h-full w-40 bg-transparent text-sm text-text placeholder:text-muted focus:outline-none"
        />
      </div>

      <div className="ms-auto flex items-center gap-1">
        {/* قائمة الإنشاء السريع (+) */}
        <Dropdown
          align="end"
          menuLabel={t('create')}
          triggerLabel={t('create')}
          triggerClassName="h-11 w-11 justify-center text-text hover:bg-primary-soft hover:text-primary"
          trigger={<Plus className="h-4 w-4" strokeWidth={1.8} />}
        >
          <DropdownItem icon={FilePlus} href="/invoices/new">{t('new_invoice')}</DropdownItem>
          <DropdownItem icon={FilePlus2} href="/quotes/new">{t('new_quote')}</DropdownItem>
          <DropdownItem icon={UserPlus} href="/partners/new">{t('new_customer')}</DropdownItem>
        </Dropdown>

        <NotificationBell />
        <LangToggle />
        <ThemeToggle />

        {/* قائمة المستخدم */}
        <Dropdown
          align="end"
          menuLabel={t('account')}
          triggerLabel={t('account')}
          triggerClassName="h-11 min-w-11 justify-center gap-2 px-2 hover:bg-primary-soft sm:min-w-0 sm:justify-start sm:px-1.5"
          trigger={
            <>
              <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-primary-soft text-xs font-semibold text-primary">
                {initial}
              </span>
              <span className="hidden text-start leading-tight sm:block">
                <span className="block max-w-32 truncate text-sm font-medium text-text">{user?.name ?? '—'}</span>
                <span className="block max-w-32 truncate text-[11px] text-muted">{active?.name ?? t('greeting')}</span>
              </span>
              <ChevronDown className="hidden h-3.5 w-3.5 shrink-0 text-muted sm:block" strokeWidth={1.8} />
            </>
          }
        >
          {/* ترويسة: المستخدم + الفرع النشط */}
          <div className="border-b border-border px-2.5 pb-2 pt-1">
            <div className="truncate text-sm font-semibold text-text">{user?.name ?? '—'}</div>
            <div className="truncate text-[11px] text-muted">{active?.name ?? '—'}</div>
          </div>

          {/* تبديل سريع بين الفروع (بلا إدارة — الإدارة في الشريط الجانبي) */}
          {branches.length > 1 && (
            <>
              <div className="px-2.5 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted">
                {tb('switch')}
              </div>
              {branches.map((b) => (
                <DropdownItem
                  key={b.id}
                  icon={b.id === activeId ? Check : Building2}
                  onClick={() => setActiveBranchId(b.id)}
                >
                  {b.name}
                </DropdownItem>
              ))}
              <div className="my-1 border-t border-border" />
            </>
          )}

          <DropdownItem icon={Settings} href="/settings">{t('settings')}</DropdownItem>
          <DropdownItem icon={LogOut} tone="danger" onClick={handleLogout}>{t('logout')}</DropdownItem>
        </Dropdown>
      </div>
    </header>
  );
}
