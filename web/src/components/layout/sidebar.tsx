'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  LayoutDashboard,
  FileText,
  Store,
  Clock,
  CalendarClock,
  FilePlus,
  FilePlus2,
  ClipboardList,
  FileMinus,
  Undo2,
  CreditCard,
  SlidersHorizontal,
  Users,
  UserPlus,
  Contact,
  Package,
  ShoppingCart,
  Handshake,
  Repeat,
  ClipboardCheck,
  Warehouse,
  BookOpen,
  Receipt,
  Building2,
  Network,
  ScrollText,
  UserCog,
  Fingerprint,
  Banknote,
  FileSignature,
  Inbox,
  Wrench,
  Workflow,
  CalendarCheck,
  Building,
  KeyRound,
  Timer,
  Factory,
  Truck,
  Send,
  MapPin,
  MapPinPlus,
  Boxes,
  BarChart3,
  LayoutTemplate,
  Settings,
  ChevronDown,
  ChevronLeft,
  ChevronsLeft,
  ChevronsRight,
  X,
  type LucideIcon,
} from 'lucide-react';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  icon: LucideIcon;
  key: string;
  /** الوحدات الجاهزة لها شاشة؛ غيرها رابط بشارة «قريباً» حتى تُبنى. */
  built?: boolean;
}

interface NavGroup {
  /** مفتاح عنوان المجموعة تحت nav.groups */
  title: string;
  /** أيقونة المجموعة — هي **كل** ما يظهر في الحالة المطوية، فلا مجموعة بلا أيقونة. */
  icon: LucideIcon;
  items: NavItem[];
}

const GROUPS: NavGroup[] = [
  {
    title: 'sales',
    icon: Receipt,
    items: [
      { href: '/invoices', icon: FileText, key: 'invoicesManage', built: true },
      { href: '/invoices/new', icon: FilePlus, key: 'invoiceCreate', built: true },
      { href: '/quotes', icon: ClipboardList, key: 'quotesManage', built: true },
      { href: '/quotes/new', icon: FilePlus2, key: 'quoteCreate', built: true },
      { href: '/credit-notes', icon: FileMinus, key: 'creditNotes', built: true },
      { href: '/returns', icon: Undo2, key: 'salesReturns', built: true },
      { href: '/recurring-invoices', icon: CalendarClock, key: 'recurringInvoices', built: true },
      { href: '/payments', icon: CreditCard, key: 'customerPayments', built: true },
      { href: '/sales-settings', icon: SlidersHorizontal, key: 'salesSettings', built: true },
    ],
  },
  {
    title: 'pos',
    icon: Store,
    items: [
      { href: '/pos', icon: Store, key: 'posStart', built: true },
      { href: '/pos/sessions', icon: Clock, key: 'posSessions', built: true },
      { href: '/pos/report', icon: Receipt, key: 'posReport', built: true },
      { href: '/pos/settings', icon: SlidersHorizontal, key: 'posSettings', built: true },
    ],
  },
  {
    title: 'customers',
    icon: Users,
    items: [
      { href: '/partners', icon: Users, key: 'customersManage', built: true },
      { href: '/partners/new', icon: UserPlus, key: 'customerCreate', built: true },
      { href: '/appointments', icon: CalendarCheck, key: 'appointments', built: true },
      { href: '/contacts', icon: Contact, key: 'contactList', built: true },
      { href: '/crm', icon: Handshake, key: 'crm', built: true },
      { href: '/customer-settings', icon: SlidersHorizontal, key: 'customerSettings', built: true },
    ],
  },
  {
    title: 'inventory',
    icon: Boxes,
    items: [
      { href: '/products', icon: Package, key: 'products', built: true },
      { href: '/inventory', icon: Warehouse, key: 'stockBalances', built: true },
      { href: '/warehouses', icon: Boxes, key: 'warehouses', built: true },
      { href: '/purchases', icon: ShoppingCart, key: 'purchases', built: true },
      { href: '/suppliers', icon: Handshake, key: 'suppliers' },
      { href: '/purchase-cycle', icon: Repeat, key: 'purchaseCycle' },
      { href: '/stock-permits', icon: ClipboardCheck, key: 'stockPermits' },
      { href: '/stocktaking', icon: Warehouse, key: 'stocktaking' },
    ],
  },
  {
    title: 'accounting',
    icon: BookOpen,
    items: [
      { href: '/accounts', icon: BookOpen, key: 'accounts', built: true },
      { href: '/expenses', icon: Receipt, key: 'expenses', built: true },
      { href: '/assets', icon: Building2, key: 'assets', built: true },
      { href: '/cost-centers', icon: Network, key: 'costCenters', built: true },
      { href: '/cheques', icon: ScrollText, key: 'cheques' },
    ],
  },
  {
    title: 'hr',
    icon: UserCog,
    items: [
      { href: '/hr', icon: UserCog, key: 'employees', built: true },
      { href: '/attendance', icon: Fingerprint, key: 'attendance' },
      { href: '/payroll', icon: Banknote, key: 'payroll' },
      { href: '/contracts', icon: FileSignature, key: 'contracts' },
      { href: '/requests', icon: Inbox, key: 'requests' },
    ],
  },
  {
    title: 'operations',
    icon: Workflow,
    items: [
      { href: '/work-orders', icon: Wrench, key: 'workOrders' },
      { href: '/workflow', icon: Workflow, key: 'workflow' },
      { href: '/bookings', icon: CalendarCheck, key: 'bookings' },
      { href: '/rentals', icon: Building, key: 'rentals' },
      { href: '/leases', icon: KeyRound, key: 'leases' },
      { href: '/time-tracking', icon: Timer, key: 'timeTracking' },
      { href: '/manufacturing', icon: Factory, key: 'manufacturing' },
    ],
  },
  {
    title: 'logistics',
    icon: Truck,
    items: [
      { href: '/fleet', icon: Truck, key: 'fleet' },
      { href: '/shipping', icon: Send, key: 'shipping' },
    ],
  },
  {
    // الفروع — عنصر مستقلّ (إدارة/إضافة/إعدادات)، منفصل عن مبدّل الفرع النشط
    // في قائمة المستخدم بالشريط العلوي.
    title: 'branches',
    icon: Network,
    items: [
      { href: '/branches', icon: MapPin, key: 'branchesManage', built: true },
      { href: '/branches/new', icon: MapPinPlus, key: 'branchAdd', built: true },
      { href: '/branches/settings', icon: SlidersHorizontal, key: 'branchSettings', built: true },
    ],
  },
  {
    title: 'system',
    icon: Settings,
    items: [
      { href: '/reports', icon: BarChart3, key: 'reports', built: true },
      { href: '/document-design', icon: LayoutTemplate, key: 'documentDesign', built: true },
      { href: '/settings', icon: Settings, key: 'settings', built: true },
    ],
  },
];

export function Sidebar({
  open,
  onClose,
  collapsed = false,
  onToggleCollapse,
}: {
  open: boolean;
  onClose: () => void;
  /** مطويّ: أيقونات فقط بعرض ضيّق. لا يُطبَّق إلا على الشاشات الواسعة. */
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const pathname = usePathname();
  const t = useTranslations('nav');

  // الدرج على الجوال يعرض القائمة كاملة دائماً — الطيّ ميزة شاشات واسعة.
  // فحين يكون الدرج مفتوحاً يسقط الطيّ، ولا يبقى المستخدم أمام أيقونات صمّاء.
  const mini = collapsed && !open;

  // المجموعة التي انبثقت قائمتها في الحالة المطوية (flyout)، وموضعها الرأسي.
  const [flyout, setFlyout] = useState<{ title: string; top: number } | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // الطيّ يُلغي أي قائمة منبثقة معلّقة — وإلا بقيت طافية بلا مرساة.
  useEffect(() => {
    if (!mini) setFlyout(null);
  }, [mini]);

  useEffect(() => {
    if (!flyout) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setFlyout(null);
    // تمرير الصفحة يفصل القائمة عن أيقونتها (موضعها ثابت محسوب) — فتُغلق.
    const onScroll = () => setFlyout(null);
    document.addEventListener('keydown', onKey);
    window.addEventListener('scroll', onScroll, true);
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('scroll', onScroll, true);
    };
  }, [flyout]);

  /** يفتح قائمة المجموعة عند حافة الشريط، بمحاذاة رأسية لأيقونتها. */
  const openFlyout = (title: string, el: HTMLElement) => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    setFlyout({ title, top: el.getBoundingClientRect().top });
  };

  // إغلاق مؤجَّل: يمنح المستخدم عبور المسافة بين الأيقونة والقائمة بلا وميض.
  const scheduleClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
    closeTimer.current = setTimeout(() => setFlyout(null), 160);
  };
  const cancelClose = () => {
    if (closeTimer.current) clearTimeout(closeTimer.current);
  };

  function isActive(href: string) {
    return pathname === href || pathname.startsWith(href + '/');
  }

  // المجموعة التي تضمّ المسار الحالي — تبقى مفتوحة تلقائياً.
  const activeGroup = GROUPS.find((g) => g.items.some((it) => isActive(it.href)))?.title;

  // نمط Accordion حصري: مجموعة واحدة مفتوحة دائماً، تُشتق من المسار النشط.
  // الافتراضي = مجموعة الصفحة الحالية (أو الأولى إن كان المسار خارج المجموعات كاللوحة).
  const [openGroup, setOpenGroup] = useState<string>(activeGroup ?? GROUPS[0].title);

  // التنقّل لصفحة في مجموعة أخرى (رابط مباشر/بحث) يفتحها تلقائياً ويُغلق سواها.
  useEffect(() => {
    if (activeGroup) setOpenGroup(activeGroup);
  }, [activeGroup]);

  // فتح حصري: النقر يفتح المجموعة المختارة (فتُغلق الأخرى)؛ ولا يُغلق الكل —
  // النقر على المفتوحة يُبقيها مفتوحة (تبقى مجموعة واحدة نشطة دائماً).
  const openExclusive = (title: string) => setOpenGroup(title);

  return (
    <>
      {/* خلفية معتمة على الجوال عند فتح الدرج */}
      {open && <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={onClose} aria-hidden />}

      <aside
        className={cn(
          'no-print fixed inset-y-0 start-0 z-50 flex w-64 flex-col border-e border-border bg-surface',
          'transition-[transform,width] duration-200 ease-out',
          'lg:static lg:z-auto lg:shrink-0 lg:translate-x-0',
          mini ? 'lg:w-16' : 'lg:w-56',
          open ? 'translate-x-0' : 'max-lg:rtl:translate-x-full max-lg:ltr:-translate-x-full'
        )}
      >
        {/* الترويسة: الشعار + زرّ الطيّ (شاشات واسعة) أو زرّ الإغلاق (الجوال) */}
        <div className={cn('flex h-14 shrink-0 items-center border-b border-border', mini ? 'justify-center gap-1 px-1' : 'gap-2 px-4')}>
          <div
            className={cn(
              'flex shrink-0 items-center justify-center rounded bg-primary font-bold text-white',
              mini ? 'h-7 w-7 text-xs' : 'h-8 w-8 text-sm'
            )}
          >
            نـ
          </div>
          {!mini && <span className="truncate text-sm font-semibold text-text">نبراس</span>}

          <button
            type="button"
            onClick={onClose}
            aria-label={t('close')}
            className="ms-auto rounded p-1 text-muted hover:bg-primary-soft hover:text-primary lg:hidden"
          >
            <X className="h-5 w-5" strokeWidth={1.7} />
          </button>

          {onToggleCollapse && (
            <button
              type="button"
              onClick={onToggleCollapse}
              aria-label={mini ? t('expand') : t('collapse')}
              aria-expanded={!mini}
              title={mini ? t('expand') : t('collapse')}
              className={cn(
                'hidden shrink-0 rounded p-1 text-muted hover:bg-primary-soft hover:text-primary lg:block',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                mini ? '' : 'ms-auto'
              )}
            >
              {/* السهم يشير دائماً لجهة الحركة: نحو حافة الشريط للطيّ، ونحو المحتوى للتوسيع. */}
              {mini
                ? <ChevronsRight className="h-4 w-4 rtl:rotate-180" strokeWidth={1.9} />
                : <ChevronsLeft className="h-4 w-4 rtl:rotate-180" strokeWidth={1.9} />}
            </button>
          )}
        </div>

        <nav className={cn('flex-1 overflow-y-auto py-3', mini ? 'lg:px-2' : 'px-2')}>
          <Link
            href="/dashboard"
            onClick={onClose}
            title={mini ? t('dashboard') : undefined}
            className={cn(
              'relative mb-3 flex h-9 items-center rounded text-sm text-muted hover:bg-primary-soft hover:text-primary',
              mini ? 'justify-center px-0' : 'gap-2 px-2',
              isActive('/dashboard') && 'bg-primary-soft font-medium text-primary'
            )}
          >
            {isActive('/dashboard') && !mini && (
              <span className="absolute inset-y-1.5 start-0 w-0.5 rounded bg-primary" />
            )}
            <LayoutDashboard className="h-[18px] w-[18px] shrink-0" strokeWidth={1.7} />
            {!mini && t('dashboard')}
          </Link>

          {GROUPS.map((group) => {
            // Accordion حصري: المجموعة مفتوحة فقط إن كانت هي المجموعة النشطة الوحيدة.
            const expanded = openGroup === group.title;
            const GroupIcon = group.icon;
            // في الحالة المطوية لا عنوان يُبرز النشاط، فتحمله الأيقونة نفسها.
            const groupActive = group.items.some((it) => isActive(it.href));

            return (
              <div key={group.title} className="mb-1">
                <button
                  type="button"
                  onClick={(e) => (mini ? openFlyout(group.title, e.currentTarget) : openExclusive(group.title))}
                  onMouseEnter={(e) => mini && openFlyout(group.title, e.currentTarget)}
                  onMouseLeave={() => mini && scheduleClose()}
                  onFocus={(e) => mini && openFlyout(group.title, e.currentTarget)}
                  aria-expanded={mini ? flyout?.title === group.title : expanded}
                  aria-haspopup={mini ? 'menu' : undefined}
                  title={mini ? t(`groups.${group.title}`) : undefined}
                  className={cn(
                    'flex h-9 w-full items-center rounded text-[13px] font-medium transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                    mini ? 'justify-center px-0' : 'gap-2 px-2',
                    groupActive || (mini && flyout?.title === group.title)
                      ? 'bg-primary-soft text-primary'
                      : 'text-muted hover:bg-primary-soft hover:text-primary'
                  )}
                >
                  <GroupIcon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.7} />
                  {!mini && (
                    <>
                      <span className="min-w-0 flex-1 truncate text-start">{t(`groups.${group.title}`)}</span>
                      {expanded ? (
                        <ChevronDown className="h-4 w-4 shrink-0" strokeWidth={1.8} />
                      ) : (
                        <ChevronLeft className="h-4 w-4 shrink-0 rtl:rotate-180" strokeWidth={1.8} />
                      )}
                    </>
                  )}
                </button>

                {/* عرض شرطي: عناصر المجموعة المفتوحة فقط (Accordion حصري) — يُخفّف الـ DOM
                    ويلغي تحريك grid-template-rows الثقيل؛ ظهور سلس على الـ compositor. */}
                {expanded && !mini && (
                  <div className="sidebar-group-in flex flex-col gap-0.5 pt-0.5">
                    {group.items.map((item) => {
                      const Icon = item.icon;
                      const active = isActive(item.href);
                      return (
                        <Link
                          key={item.key}
                          href={item.href}
                          onClick={onClose}
                          className={cn(
                            'relative flex h-9 items-center gap-2 rounded ps-4 pe-2 text-sm text-muted hover:bg-primary-soft hover:text-primary',
                            active && 'bg-primary-soft font-medium text-primary'
                          )}
                        >
                          {active && (
                            <span className="absolute inset-y-1.5 start-0 w-0.5 rounded bg-primary" />
                          )}
                          <Icon className="h-4 w-4 shrink-0" strokeWidth={1.7} />
                          <span className="truncate">{t(item.key)}</span>
                          {!item.built && (
                            <span className="ms-auto shrink-0 rounded bg-border px-1.5 py-0.5 text-[10px] font-normal text-muted">
                              {t('soon')}
                            </span>
                          )}
                        </Link>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </nav>
      </aside>

      {/* قائمة منبثقة للمجموعة في الحالة المطوية — ترويستها اسم المجموعة، فتؤدّي
          دور الـ tooltip والقائمة معاً. موضعها `fixed` لأن الشريط `overflow-y-auto`
          يقصّ أي عنصر مطلق داخله. */}
      {mini && flyout && (
        <div
          role="menu"
          aria-label={t(`groups.${flyout.title}`)}
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
          style={{ top: flyout.top, insetInlineStart: '4rem' }}
          className="fixed z-50 ms-1 hidden max-h-[70vh] w-56 overflow-y-auto rounded border border-border bg-surface p-1 shadow-md lg:block"
        >
          <div className="border-b border-border px-2.5 pb-1.5 pt-1 text-[11px] font-semibold text-muted">
            {t(`groups.${flyout.title}`)}
          </div>
          {(GROUPS.find((g) => g.title === flyout.title)?.items ?? []).map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <Link
                key={item.key}
                href={item.href}
                role="menuitem"
                onClick={() => setFlyout(null)}
                className={cn(
                  'flex items-center gap-2 rounded px-2.5 py-1.5 text-sm',
                  active ? 'bg-primary-soft font-medium text-primary' : 'text-text hover:bg-primary-soft hover:text-primary'
                )}
              >
                <Icon className="h-4 w-4 shrink-0" strokeWidth={1.7} />
                <span className="truncate">{t(item.key)}</span>
                {!item.built && (
                  <span className="ms-auto shrink-0 rounded bg-border px-1.5 py-0.5 text-[10px] text-muted">
                    {t('soon')}
                  </span>
                )}
              </Link>
            );
          })}
        </div>
      )}

    </>
  );
}
