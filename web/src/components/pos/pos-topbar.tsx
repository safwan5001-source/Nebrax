'use client';

import Link from 'next/link';
import { useEffect, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter } from 'next/navigation';
import { useTheme } from 'next-themes';
import {
  Archive, Banknote, Building2, ChevronDown, CircleDot, History, Languages, LogOut,
  MoreHorizontal, Moon, Power, ReceiptText, Repeat2, RotateCcw, Settings,
  Sun, UserRound, Warehouse,
} from 'lucide-react';
import type { Warehouse as WarehouseType } from '@/lib/warehouse';
import { Dropdown, DropdownItem } from '@/components/ui/dropdown';
import { logout } from '@/lib/auth';
import { POS_RETURN_HREF } from '@/lib/pos-workspace';

/** شريط تشغيلي لـ POS: يعرض السياق الفعلي والإجراءات المتاحة فقط. */
export function PosTopbar({
  cashier,
  branch,
  session,
  warehouses = [],
  warehouseId = '',
  warehouseDisabled = false,
  heldCount = 0,
  onWarehouseChange,
  onManageSession,
  onOpenHeld,
  onOpenRecentInvoices,
  onOpenCashDrawer,
  onReturn,
  onExchange,
  onLogout,
  exchangeDisabled = false,
  cashDrawerDisabled = true,
  cashDrawerBusy = false,
}: {
  cashier: string;
  branch: string;
  session?: { number: string; pos_device?: { name: string; code: string | null } | null } | null;
  warehouses?: WarehouseType[];
  warehouseId?: string;
  warehouseDisabled?: boolean;
  heldCount?: number;
  onWarehouseChange?: (warehouseId: string) => void;
  onManageSession?: () => void;
  onOpenHeld?: () => void;
  onOpenRecentInvoices?: () => void;
  onOpenCashDrawer?: () => void;
  onReturn?: () => void;
  onExchange?: () => void;
  onLogout?: () => void;
  exchangeDisabled?: boolean;
  cashDrawerDisabled?: boolean;
  cashDrawerBusy?: boolean;
}) {
  const t = useTranslations('pos');
  const tc = useTranslations('common');
  const tt = useTranslations('topbar');
  const router = useRouter();
  const locale = useLocale();
  const { theme, setTheme } = useTheme();
  const [online, setOnline] = useState(true);

  useEffect(() => {
    const sync = () => setOnline(typeof navigator === 'undefined' || navigator.onLine);
    sync();
    window.addEventListener('online', sync);
    window.addEventListener('offline', sync);
    return () => {
      window.removeEventListener('online', sync);
      window.removeEventListener('offline', sync);
    };
  }, []);

  const userInitial = cashier.trim().slice(0, 2) || '؟';
  const sessionLabel = session?.number ?? null;
  const deviceLabel = session?.pos_device?.code || session?.pos_device?.name || null;

  async function handleLogout() {
    if (onLogout) {
      onLogout();
      return;
    }
    await logout();
    router.replace('/login');
  }

  function toggleLanguage() {
    const next = locale === 'ar' ? 'en' : 'ar';
    document.cookie = `locale=${next};path=/;max-age=31536000`;
    router.refresh();
  }

  return (
    <header className="no-print flex h-14 shrink-0 items-center gap-2 border-b border-border bg-surface px-3 sm:px-4">
      <Link
        href={POS_RETURN_HREF}
        className="inline-flex min-h-11 shrink-0 items-center gap-2 rounded-md border border-border px-2.5 text-sm font-semibold text-text hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
        aria-label={t('return_to_system')}
      >
        <RotateCcw className="h-4 w-4" strokeWidth={1.7} />
        <span className="hidden xl:inline">{t('return_to_system')}</span>
      </Link>

      <div className="min-w-0 border-s border-border ps-2 sm:ps-3">
        <div className="truncate text-sm font-semibold text-text">{t('pos_title')}</div>
        <div className="hidden items-center gap-1.5 text-xs text-muted sm:flex">
          <Building2 className="h-3.5 w-3.5 shrink-0" strokeWidth={1.7} />
          <span className="truncate">{branch}</span>
          {deviceLabel && <><span aria-hidden>·</span><span className="num truncate">{deviceLabel}</span></>}
        </div>
      </div>

      <div className="hidden min-w-0 items-center gap-1.5 text-xs md:flex">
        <CircleDot className={'h-3.5 w-3.5 shrink-0 ' + (online ? 'text-positive' : 'text-negative')} strokeWidth={1.8} aria-hidden />
        <span className={online ? 'text-text' : 'text-negative'}>{online ? t('network_connected') : t('network_offline')}</span>
      </div>

      {sessionLabel && (
        <div className="hidden min-w-0 items-center gap-1.5 rounded-md bg-background px-2 py-1 text-xs text-muted lg:flex" title={t('session')}>
          <span className="text-text">{t('session')}</span>
          <span className="num truncate font-semibold text-text">{sessionLabel}</span>
        </div>
      )}

      <div className="ms-auto flex shrink-0 items-center gap-1">
        <button
          type="button"
          onClick={onOpenRecentInvoices}
          className="inline-flex min-h-11 items-center gap-2 rounded-md px-2.5 text-sm font-semibold text-text hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          aria-label={t('recent_pos_invoices')}
        >
          <ReceiptText className="h-4 w-4" strokeWidth={1.7} />
          <span className="hidden xl:inline">{t('recent_pos_invoices')}</span>
        </button>
        <button
          type="button"
          onClick={onOpenHeld}
          className="relative inline-flex min-h-11 items-center gap-2 rounded-md px-2.5 text-sm font-semibold text-text hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          aria-label={t('held')}
        >
          <Archive className="h-4 w-4" strokeWidth={1.7} />
          <span className="hidden xl:inline">{t('held')}</span>
          {heldCount > 0 && <span className="num grid min-w-5 place-items-center rounded bg-primary px-1.5 py-0.5 text-[11px] font-bold text-white">{heldCount}</span>}
        </button>

        <button
          type="button"
          onClick={onManageSession}
          className="hidden min-h-11 items-center gap-2 rounded-md px-2.5 text-sm font-semibold text-text hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 lg:inline-flex"
        >
          <Power className="h-4 w-4" strokeWidth={1.7} />
          <span>{t('manage_shift')}</span>
        </button>

        <Dropdown
          align="end"
          menuLabel={t('more_actions')}
          triggerLabel={t('more_actions')}
          triggerClassName="min-h-11 min-w-11 justify-center text-text hover:bg-primary-soft hover:text-primary"
          mobilePopover
          trigger={<MoreHorizontal className="h-5 w-5" strokeWidth={1.7} />}
        >
          <div className="border-b border-border px-2.5 py-2 lg:hidden">
            <div className="text-sm font-semibold text-text">{t('pos_title')}</div>
            <div className="mt-0.5 flex items-center gap-1.5 text-xs text-muted">
              <CircleDot className={'h-3.5 w-3.5 ' + (online ? 'text-positive' : 'text-negative')} strokeWidth={1.8} />
              {online ? t('network_connected') : t('network_offline')}
              {sessionLabel && <><span aria-hidden>·</span><span className="num">{sessionLabel}</span></>}
            </div>
          </div>
          <div className="lg:hidden">
            <DropdownItem icon={Power} onClick={onManageSession}>{t('manage_shift')}</DropdownItem>
          </div>
          {warehouses.length > 0 && (
            <label className="mx-1 my-1.5 flex items-center gap-2 rounded px-2 py-2 text-sm text-text hover:bg-primary-soft">
              <Warehouse className="h-4 w-4 shrink-0 text-muted" strokeWidth={1.7} />
              <span className="sr-only">{t('warehouse')}</span>
              <select
                className="min-w-0 flex-1 bg-transparent text-sm outline-none disabled:text-muted"
                value={warehouseId}
                disabled={warehouseDisabled}
                onChange={(event) => onWarehouseChange?.(event.target.value)}
                aria-label={t('warehouse')}
              >
                {warehouses.map((warehouse) => <option key={warehouse.id} value={warehouse.id}>{warehouse.code} — {warehouse.name}</option>)}
              </select>
            </label>
          )}
          <div className="my-1 border-t border-border" />
          <DropdownItem icon={Banknote} onClick={onOpenCashDrawer} disabled={cashDrawerDisabled}>
            {cashDrawerBusy ? t('cash_drawer_opening') : t('sc_drawer')}
          </DropdownItem>
          {cashDrawerDisabled && (
            <p className="px-3 pb-2 text-xs leading-relaxed text-muted">{t('cash_drawer_unavailable')}</p>
          )}
          <div className="my-1 border-t border-border" />
          <DropdownItem icon={RotateCcw} onClick={onReturn} disabled={!session}>{t('return_action')}</DropdownItem>
          <DropdownItem icon={Repeat2} onClick={onExchange} disabled={!session || exchangeDisabled}>{t('exchange_action')}</DropdownItem>
        </Dropdown>

        <Dropdown
          align="end"
          menuLabel={tt('account')}
          triggerLabel={tt('account')}
          triggerClassName="min-h-11 min-w-11 justify-center gap-1.5 px-1.5 hover:bg-primary-soft"
          mobilePopover
          trigger={
            <>
              <span className="grid h-7 w-7 place-items-center rounded-full bg-primary-soft text-xs font-bold text-primary">{userInitial}</span>
              <span className="hidden max-w-28 truncate text-sm font-semibold text-text 2xl:inline">{cashier}</span>
              <ChevronDown className="hidden h-3.5 w-3.5 text-muted 2xl:block" strokeWidth={1.7} />
            </>
          }
        >
          <div className="border-b border-border px-2.5 py-2">
            <div className="truncate text-sm font-semibold text-text">{cashier}</div>
            <div className="truncate text-xs text-muted">{branch}</div>
          </div>
          <DropdownItem icon={Languages} onClick={toggleLanguage}>{tc('languageToggle')}</DropdownItem>
          <DropdownItem icon={theme === 'dark' ? Sun : Moon} onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}>{tc('themeToggle')}</DropdownItem>
          <div className="my-1 border-t border-border" />
          <DropdownItem icon={Settings} href="/settings">{tt('settings')}</DropdownItem>
          <DropdownItem icon={LogOut} tone="danger" onClick={handleLogout}>{tt('logout')}</DropdownItem>
        </Dropdown>
      </div>
    </header>
  );
}
