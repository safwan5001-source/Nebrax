'use client';

import Link from 'next/link';
import { useEffect, useRef, useState } from 'react';
import { useLocale } from 'next-intl';
import { ArrowRight, Check, ChevronDown, ExternalLink, Menu, Store, X } from 'lucide-react';
import { CompanyLogoMark } from '@/components/layout/company-logo-mark';
import { LangToggle } from '@/components/layout/lang-toggle';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { Dropdown, DropdownItem } from '@/components/ui/dropdown';
import { useCompany } from '@/lib/company';
import { commerceWorkspaceMessage } from '@/modules/commerce-workspace/messages';
import { useCommerceStoreContext } from '@/modules/commerce-workspace/store-context';
import { CommerceWorkspaceNav } from './commerce-workspace-nav';

export function CommerceWorkspaceShell({ children }: { children: React.ReactNode }) {
  const locale = useLocale();
  const t = (key: Parameters<typeof commerceWorkspaceMessage>[1]) => commerceWorkspaceMessage(locale, key);
  const company = useCompany();
  const { catalog, selectedStoreId, setSelectedStoreId, viewStoreUrl } = useCommerceStoreContext();
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

  const selectedStore = catalog.status === 'ready'
    ? catalog.stores.find((store) => store.id === selectedStoreId)
    : null;

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
          href="/commerce"
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
          <span className="text-xs text-muted">{t('storeSelectorLabel')}</span>
          {catalog.status === 'ready' && catalog.stores.length > 1 ? (
            <Dropdown
              align="start"
              menuLabel={t('storeSelectorLabel')}
              triggerLabel={t('storeSelectorLabel')}
              triggerClassName="h-9 max-w-52 gap-1.5 px-2 text-sm text-text hover:bg-primary-soft hover:text-primary"
              trigger={(
                <>
                  <Store className="h-4 w-4 shrink-0" strokeWidth={1.7} />
                  <span className="truncate">{selectedStore?.name ?? t('storeSelectorLoading')}</span>
                  <ChevronDown className="h-3.5 w-3.5 shrink-0 text-muted" strokeWidth={1.7} />
                </>
              )}
            >
              {catalog.stores.map((store) => (
                <DropdownItem
                  key={store.id}
                  icon={store.id === selectedStoreId ? Check : Store}
                  onClick={() => setSelectedStoreId(store.id)}
                >
                  {store.name}
                </DropdownItem>
              ))}
            </Dropdown>
          ) : (
            <span
              className="inline-flex h-9 max-w-64 items-center gap-1.5 px-2 text-sm text-muted"
              title={catalog.status === 'unavailable' ? t('storeSelectorUnavailableHint') : undefined}
            >
              <Store className="h-4 w-4 shrink-0" strokeWidth={1.7} />
              <span className="truncate">
                {catalog.status === 'ready' && selectedStore
                  ? selectedStore.name
                  : catalog.status === 'empty'
                    ? t('storeSelectorEmpty')
                    : t('storeSelectorUnavailable')}
              </span>
            </span>
          )}
        </div>

        <div className="ms-auto flex items-center gap-1">
          {viewStoreUrl ? (
            <a
              href={viewStoreUrl}
              target="_blank"
              rel="noreferrer"
              className="inline-flex min-h-11 items-center gap-2 rounded px-2.5 text-sm font-medium text-text hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            >
              <ExternalLink className="h-4 w-4" strokeWidth={1.7} />
              <span className="hidden sm:inline">{t('viewStore')}</span>
            </a>
          ) : (
            <span
              className="inline-flex min-h-11 cursor-not-allowed items-center gap-2 rounded px-2.5 text-sm text-muted"
              title={t('viewStoreUnavailableHint')}
              aria-disabled="true"
            >
              <ExternalLink className="h-4 w-4" strokeWidth={1.7} />
              <span className="hidden sm:inline">{t('viewStore')}</span>
            </span>
          )}
          <Link
            href="/dashboard"
            className="inline-flex min-h-11 items-center gap-2 rounded px-2.5 text-sm font-medium text-text hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          >
            <ArrowRight aria-hidden="true" className="h-4 w-4 rtl:rotate-180" strokeWidth={1.7} />
            <span className="hidden sm:inline">{t('backToAwj')}</span>
          </Link>
          <LangToggle />
          <ThemeToggle />
        </div>
      </header>

      <div className="flex min-h-0 flex-1">
        <aside className="no-print hidden w-64 shrink-0 overflow-y-auto border-e border-border bg-surface p-3 lg:block">
          <CommerceWorkspaceNav />
        </aside>

        {navigationOpen && <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={dismissNavigation} aria-hidden />}
        <aside
          aria-hidden={!navigationOpen || undefined}
          {...(!navigationOpen ? { inert: true } : {})}
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
            <CommerceWorkspaceNav onNavigate={dismissNavigation} />
          </div>
        </aside>

        <main id="commerce-workspace-content" className="min-w-0 flex-1 overflow-y-auto">
          <div className="mx-auto w-full max-w-7xl p-4 sm:p-6">
            {children}
          </div>
        </main>
      </div>
    </div>
  );
}
