'use client';

/**
 * قشرة لوحة المنصة (H1-2) — للإدارة العليا فقط، لا علاقة لها بقشرة الـERP (Sidebar/Topbar).
 * المرجع: docs/plans/platform/AWJ-PLATFORM-UX-H1-1-UX-SPEC.md §4–§5.
 * الاتجاه من <html dir> وحده، والألوان من رموز gate-off فقط، ولا تُجرى أي طلبات بيانات هنا.
 */
import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Building2, LayoutDashboard, LogOut, Menu, ServerCog, ShieldCheck, Tag, X } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { LangToggle } from '@/components/layout/lang-toggle';
import { ThemeToggle } from '@/components/layout/theme-toggle';
import { currentPlatformAdministrator, isPlatformAuthenticated, platformLogout } from '@/lib/platform-auth';
import { cn } from '@/lib/utils';

type NavKey = 'overview' | 'tenants' | 'prices' | 'integrations' | 'documentOperations';

interface NavItem {
  key: NavKey;
  href: string;
  icon: typeof LayoutDashboard;
  /** الصفحة الرئيسية تطابق تماماً؛ البقية بالبادئة عند حد مقطع المسار (تفصيل المؤسسة يتبع «المؤسسات»). */
  exact?: boolean;
}

export const PLATFORM_NAV: readonly NavItem[] = [
  { key: 'overview', href: '/platform', icon: LayoutDashboard, exact: true },
  { key: 'tenants', href: '/platform/tenants', icon: Building2 },
  { key: 'prices', href: '/platform/prices', icon: Tag },
  { key: 'integrations', href: '/platform/integrations', icon: ServerCog },
  { key: 'documentOperations', href: '/platform/document-operations', icon: ShieldCheck },
];

export function activePlatformNav(pathname: string | null): NavItem | null {
  if (!pathname) return null;
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  return (
    PLATFORM_NAV.find((item) => (item.exact ? path === item.href : path === item.href || path.startsWith(`${item.href}/`))) ??
    null
  );
}

const DESKTOP_QUERY = '(min-width: 1024px)';

export function PlatformShell({ children }: { children: React.ReactNode }) {
  const t = useTranslations('platformShell');
  const router = useRouter();
  const pathname = usePathname();
  const [ready, setReady] = useState(false);
  const [name, setName] = useState('');
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [desktop, setDesktop] = useState(false);
  const navRef = useRef<HTMLElement>(null);
  const menuRef = useRef<HTMLButtonElement>(null);
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!isPlatformAuthenticated()) {
      router.replace('/platform/login');
      return;
    }
    setName(currentPlatformAdministrator()?.name ?? '');
    setReady(true);
  }, [router]);

  // يسبق تأثير التركيز أدناه: عنصر inert لا يقبل focus()، فيجب رفعه قبل نقل التركيز.
  // React 18 لا يمرّر inert المنطقي إلى DOM، فنضبطه يدوياً: مُعطَّل فقط للدرج المغلق تحت lg.
  useEffect(() => {
    const nav = navRef.current;
    if (!nav) return;
    if (!open && !desktop) nav.setAttribute('inert', '');
    else nav.removeAttribute('inert');
  }, [open, desktop, ready]);

  // نركّز الزر المُشغِّل قبل إخفاء الدرج، كما يفعل dismissSidebar في قشرة الـERP.
  const dismiss = useCallback(() => {
    menuRef.current?.focus();
    setOpen(false);
  }, []);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const root = document.documentElement;
    root.classList.add('overflow-hidden');
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape') dismiss();
    };
    document.addEventListener('keydown', onKey);
    return () => {
      root.classList.remove('overflow-hidden');
      document.removeEventListener('keydown', onKey);
    };
  }, [open, dismiss]);

  // ≥lg القائمة ثابتة وظاهرة؛ بين الحالتين نغلق الدرج ولا نُبقي القفل.
  useEffect(() => {
    const media = window.matchMedia(DESKTOP_QUERY);
    const sync = () => {
      setDesktop(media.matches);
      if (media.matches) setOpen(false);
    };
    sync();
    media.addEventListener('change', sync);
    return () => media.removeEventListener('change', sync);
  }, []);

  async function signOut() {
    setSigningOut(true);
    await platformLogout();
    router.replace('/platform/login');
  }

  const active = activePlatformNav(pathname);
  const crumbs = active && active.key !== 'overview' ? [t('brand'), t(active.key)] : [t('brand')];

  if (!ready) {
    return <div className="min-h-screen bg-background" aria-busy="true" />;
  }

  return (
    <div className="min-h-screen bg-background text-text lg:flex">
      <a
        href="#platform-content"
        className="sr-only focus:not-sr-only focus:fixed focus:start-2 focus:top-2 focus:z-50 focus:rounded focus:bg-surface focus:px-3 focus:py-2 focus:text-sm focus:font-medium focus:text-primary focus:ring-2 focus:ring-primary"
      >
        {t('skipToContent')}
      </a>

      {open && <div className="fixed inset-0 z-30 bg-[color:var(--awj-elevation-scrim,rgb(0_0_0/0.4))] lg:hidden" aria-hidden="true" onClick={dismiss} />}

      <nav
        id="platform-nav"
        aria-label={t('navLabel')}
        ref={navRef}
        data-open={open ? 'true' : 'false'}
        className={cn(
          'no-print fixed inset-y-0 start-0 z-40 flex w-[min(100%,20rem)] flex-col border-e border-border bg-surface',
          'pb-[max(0.75rem,env(safe-area-inset-bottom))] pt-[max(0.75rem,env(safe-area-inset-top))]',
          'transition-transform duration-200 ease-out motion-reduce:transition-none',
          open ? 'translate-x-0' : '-translate-x-full rtl:translate-x-full',
          'lg:sticky lg:top-0 lg:z-auto lg:h-screen lg:w-60 lg:shrink-0 lg:translate-x-0 lg:rtl:translate-x-0'
        )}
      >
        <div className="flex items-center justify-between gap-2 px-4 pb-3">
          <span className="flex min-w-0 items-center gap-2 text-sm font-semibold text-text">
            <ShieldCheck className="h-5 w-5 shrink-0 text-primary" strokeWidth={1.7} aria-hidden="true" />
            <span className="truncate">{t('brand')}</span>
          </span>
          <Button
            ref={closeRef as React.Ref<HTMLElement>}
            variant="ghost"
            size="icon"
            className="h-11 w-11 lg:hidden"
            aria-label={t('closeMenu')}
            onClick={dismiss}
          >
            <X className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
          </Button>
        </div>

        <ul className="flex-1 space-y-1 overflow-y-auto px-2">
          {PLATFORM_NAV.map((item) => {
            const Icon = item.icon;
            const current = active?.key === item.key;
            return (
              <li key={item.key}>
                <Link
                  href={item.href}
                  aria-current={current ? 'page' : undefined}
                  onClick={() => setOpen(false)}
                  className={cn(
                    'flex min-h-11 items-center gap-3 rounded px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary',
                    current ? 'bg-primary-soft text-primary' : 'text-text hover:bg-primary-soft'
                  )}
                >
                  <Icon className="h-4 w-4 shrink-0" strokeWidth={1.7} aria-hidden="true" />
                  {t(item.key)}
                </Link>
              </li>
            );
          })}
        </ul>

        {name && (
          <p className="border-t border-border px-4 pt-3 text-xs text-muted lg:hidden">{t('signedInAs', { name })}</p>
        )}
      </nav>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="no-print sticky top-0 z-20 flex min-h-14 items-center gap-1 border-b border-border bg-surface px-2 sm:gap-2 sm:px-4">
          <Button
            ref={menuRef as React.Ref<HTMLElement>}
            variant="ghost"
            size="icon"
            className="h-11 w-11 shrink-0 lg:hidden"
            aria-label={t('openMenu')}
            aria-expanded={open}
            aria-controls="platform-nav"
            onClick={() => setOpen(true)}
          >
            <Menu className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
          </Button>

          <span className="min-w-0 truncate text-sm font-semibold text-text lg:hidden">{t('brand')}</span>

          <nav aria-label={t('breadcrumbLabel')} className="hidden min-w-0 sm:block lg:block">
            <ol className="flex items-center gap-1.5 text-sm text-muted">
              {crumbs.map((crumb, index) => (
                <li key={crumb} className="flex min-w-0 items-center gap-1.5">
                  {index > 0 && <span aria-hidden="true">/</span>}
                  <span className={cn('truncate', index === crumbs.length - 1 && 'font-medium text-text')} aria-current={index === crumbs.length - 1 ? 'page' : undefined}>
                    {crumb}
                  </span>
                </li>
              ))}
            </ol>
          </nav>

          <div className="flex-1" />

          {/* shrink-0: بدونه يضغط flex الزرّين إلى أقل من 44px عند 320px مع تسمية الخروج الإنجليزية الأطول. */}
          <div className="flex shrink-0 items-center">
            <LangToggle />
            <ThemeToggle />
          </div>
          {name && (
            <span className="hidden max-w-40 truncate text-xs text-muted sm:inline" title={name}>
              {name}
            </span>
          )}
          <Button variant="outline" className="h-11 shrink-0 px-3" onClick={signOut} disabled={signingOut}>
            <LogOut className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
            {signingOut ? t('signingOut') : t('logout')}
          </Button>
        </header>

        {/*
          الصفحات القائمة تحمل <main> خاصاً بها، فالحاوية هنا div لا main حتى لا يتداخل landmarkان.
          أدنى ارتفاع الصفحات (min-h-screen) يُعطَّل من هنا فقط، فلا تمرير رأسي زائد تحت الشريط العلوي.
        */}
        <div
          id="platform-content"
          tabIndex={-1}
          className="min-w-0 flex-1 pb-[env(safe-area-inset-bottom)] outline-none [&>div]:min-h-0 [&>main]:min-h-0"
        >
          {children}
        </div>
      </div>
    </div>
  );
}
