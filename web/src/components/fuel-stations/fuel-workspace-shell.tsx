'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { ArrowRight, Building2, Check, ChevronDown, Menu, X } from 'lucide-react';
import { BranchScope } from '@/components/layout/branch-scope';
import { CompanyLogoMark } from '@/components/layout/company-logo-mark';
import { LangToggle } from '@/components/layout/lang-toggle';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { Dropdown, DropdownItem } from '@/components/ui/dropdown';
import { useBranches } from '@/lib/branch';
import { useCompany } from '@/lib/company';
import { FuelWorkspaceNav } from './fuel-workspace-nav';

/**
 * غلاف تشغيل مستقل لمحطات الوقود. لا يرث Sidebar أو Topbar تطبيق Nebrax العام؛
 * لكنه يبقى ضمن مزوّدات الجذر نفسها ويحافظ على نطاق الفرع المستخدم في الشاشات.
 */
export function FuelWorkspaceShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations('fuelWorkspaceShell');
  const branchT = useTranslations('branches');
  const company = useCompany();
  const { branches, active, activeId, setActiveBranchId } = useBranches();
  const [navigationOpen, setNavigationOpen] = useState(false);
  const menuButtonRef = useRef<HTMLButtonElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!navigationOpen) return;
    requestAnimationFrame(() => closeButtonRef.current?.focus());
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setNavigationOpen(false);
        requestAnimationFrame(() => menuButtonRef.current?.focus());
      }
    };
    document.addEventListener('keydown', dismissOnEscape);
    return () => document.removeEventListener('keydown', dismissOnEscape);
  }, [navigationOpen]);

  const dismissNavigation = () => {
    setNavigationOpen(false);
    requestAnimationFrame(() => menuButtonRef.current?.focus());
  };

  return (
    <div className="flex h-screen w-full flex-col overflow-hidden bg-background [height:100dvh]">
      <header className="no-print flex h-14 shrink-0 items-center gap-2 border-b border-border bg-surface px-3 sm:px-4">
        <button
          type="button"
          ref={menuButtonRef}
          onClick={() => setNavigationOpen(true)}
          aria-label={t('openNavigation')}
          className="flex h-11 w-11 shrink-0 items-center justify-center rounded text-text hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 lg:hidden"
        >
          <Menu className="h-5 w-5" strokeWidth={1.7} />
        </button>

        <Link
          href="/fuel-stations"
          className="flex min-w-0 items-center gap-2 rounded px-1 py-1 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          aria-label={t('workspaceHome')}
        >
          <CompanyLogoMark logo={company?.logo} name={company?.name} size="sm" className="hidden sm:block" />
          <span className="min-w-0">
            <span className="block truncate text-sm font-semibold text-text">{t('title')}</span>
            <span className="hidden truncate text-[11px] text-muted md:block">{company?.name ?? t('workspaceContext')}</span>
          </span>
        </Link>

        <div className="hidden min-w-0 items-center gap-2 border-s border-border ps-3 md:flex">
          <span className="text-xs text-muted">{t('operatingContext')}</span>
          {branches.length > 1 ? (
            <Dropdown
              align="start"
              menuLabel={branchT('switch')}
              triggerLabel={branchT('switch')}
              triggerClassName="h-9 max-w-52 gap-1.5 px-2 text-sm text-text hover:bg-primary-soft hover:text-primary"
              trigger={<><Building2 className="h-4 w-4 shrink-0" strokeWidth={1.7} /><span className="truncate">{active?.name ?? t('loadingContext')}</span><ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted" strokeWidth={1.7} /></>}
            >
              {branches.map((branch) => (
                <DropdownItem
                  key={branch.id}
                  icon={branch.id === activeId ? Check : Building2}
                  onClick={() => setActiveBranchId(branch.id)}
                >
                  {branch.name}
                </DropdownItem>
              ))}
            </Dropdown>
          ) : (
            <span className="inline-flex h-9 max-w-52 items-center gap-1.5 px-2 text-sm text-text">
              <Building2 className="h-4 w-4 shrink-0 text-muted" strokeWidth={1.7} />
              <span className="truncate">{active?.name ?? t('loadingContext')}</span>
            </span>
          )}
        </div>

        <div className="ms-auto flex items-center gap-1">
          <Link
            href="/dashboard"
            className="inline-flex min-h-11 items-center gap-2 rounded px-2.5 text-sm font-medium text-text hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <ArrowRight aria-hidden="true" className="h-4 w-4 rtl:rotate-180" strokeWidth={1.7} />
            <span className="hidden sm:inline">{t('backToNebrax')}</span>
          </Link>
          <LangToggle />
          <ThemeToggle />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="no-print hidden w-64 shrink-0 overflow-y-auto border-e border-border bg-surface p-3 lg:block">
          <FuelWorkspaceNav />
        </aside>

        {navigationOpen && <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={dismissNavigation} aria-hidden />}
        <aside
          aria-hidden={!navigationOpen || undefined}
          inert={!navigationOpen || undefined}
          className={`no-print fixed inset-y-0 start-0 z-50 flex w-72 flex-col border-e border-border bg-surface transition-transform duration-200 ease-out lg:hidden ${navigationOpen ? 'translate-x-0' : 'rtl:translate-x-full ltr:-translate-x-full'}`}
        >
          <div className="flex h-14 shrink-0 items-center gap-2 border-b border-border px-4">
            <span className="truncate text-sm font-semibold text-text">{t('navigationTitle')}</span>
            <button
              type="button"
              ref={closeButtonRef}
              onClick={dismissNavigation}
              aria-label={t('closeNavigation')}
              className="ms-auto flex h-11 w-11 shrink-0 items-center justify-center rounded text-muted hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <X className="h-5 w-5" strokeWidth={1.7} />
            </button>
          </div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">
            <FuelWorkspaceNav onNavigate={dismissNavigation} />
          </div>
        </aside>

        <main id="fuel-workspace-content" className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">
            <BranchScope>{children}</BranchScope>
          </div>
        </main>
      </div>
    </div>
  );
}
