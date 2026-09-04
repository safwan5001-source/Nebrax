'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Banknote,
  BarChart3,
  BookOpen,
  BookText,
  Boxes,
  Building,
  Building2,
  CalendarCheck,
  CalendarClock,
  ChevronDown,
  ChevronLeft,
  ChevronsLeft,
  ChevronsRight,
  ClipboardCheck,
  ClipboardList,
  Clock,
  Compass,
  Contact,
  CreditCard,
  Factory,
  FileMinus,
  FilePlus,
  FilePlus2,
  FileQuestion,
  FileSignature,
  FileText,
  Fingerprint,
  Fuel,
  Handshake,
  Hash,
  Inbox,
  KeyRound,
  LayoutDashboard,
  LayoutGrid,
  LayoutTemplate,
  MapPin,
  MapPinPlus,
  Network,
  Package,
  PackagePlus,
  Receipt,
  ReceiptText,
  ScrollText,
  Send,
  Settings,
  ShieldCheck,
  ShoppingCart,
  SlidersHorizontal,
  Store,
  Terminal,
  Timer,
  Truck,
  type LucideIcon,
  Undo2,
  UserCog,
  UserPlus,
  Users,
  WalletCards,
  Warehouse,
  Webhook,
  Workflow,
  Wrench,
  X,
} from 'lucide-react';
import { CompanyLogoMark } from '@/components/layout/company-logo-mark';
import { useCompany } from '@/lib/company';
import { cn } from '@/lib/utils';
import { api } from '@/lib/api';
import { currentUser } from '@/lib/auth';
import { hiddenApplicationKeys, isNavEntryVisible } from '@/components/layout/nav-visibility';
import { POS_SIDEBAR_LAUNCH_ITEMS, posNavNewTabAnchorProps } from '@/lib/pos-workspace';

interface NavItem {
  href: string;
  icon: LucideIcon;
  key: string;
  /** الوحدات الجاهزة لها شاشة؛ غيرها رابط بشارة «قريباً» حتى تُبنى. */
  built?: boolean;
  /**
   * مفتاح `ApplicationCatalog` الذي يتحكم بظهور هذا العنصر وحده — يختفي إن
   * أوقفه المالك من `/applications` أو إن لم يكن للمؤسسة استحقاق تجاري نافذ
   * للقدرة. القرار كامله يأتي محسوباً من `GET /applications/nav-state`؛ لا
   * تحسب الواجهة استحقاقاً بنفسها. غياب المفتاح يعني ظهوراً دائماً (قدرة
   * إلزامية أو بلا مفتاح تفعيل مستقل).
   */
  appKey?: string;
  /**
   * صلاحية RBAC مطلوبة لإظهار عنصر تشغيلي حساس في الشريط — تُفحَص بمرآة
   * `Rbac::allows` نفسها (`hasPermission`)، فلا يظهر رابط يردّ مساره 403.
   */
  permission?: string;
  /** يفتح الرابط في تبويب جديد. «بدء البيع» يبقى في نفس التبويب. */
  openInNewTab?: boolean;
}

interface NavGroup {
  /** مفتاح عنوان المجموعة تحت nav.groups */
  title: string;
  /** أيقونة المجموعة — هي **كل** ما يظهر في الحالة المطوية، فلا مجموعة بلا أيقونة. */
  icon: LucideIcon;
  items: NavItem[];
  /** بديل `appKey` على مستوى المجموعة كاملة — يخفيها بعناصرها دفعة واحدة. */
  appKey?: string;
  /**
   * صلاحية RBAC على مستوى المجموعة كاملة — تُفحَص بمرآة `Rbac::allows` نفسها،
   * فتختفي المجموعة بعناصرها لمن لا يملكها (بدل ترك رأسٍ بلا عناصر). تُستعمل
   * حين تشترك كل عناصر المجموعة في صلاحية واحدة (كمجموعة المطورين).
   */
  permission?: string;
}

const POS_NAV_ICONS: Record<(typeof POS_SIDEBAR_LAUNCH_ITEMS)[number]['key'], LucideIcon> = {
  posStart: Store,
  posSessions: Clock,
  posReport: Receipt,
  posAudit: ClipboardCheck,
  posSettings: SlidersHorizontal,
};

const GROUPS: NavGroup[] = [
  {
    title: 'sales',
    icon: Receipt,
    items: [
      { href: '/invoices', icon: FileText, key: 'invoicesManage', built: true },
      { href: '/delivery-notes', icon: ClipboardCheck, key: 'deliveryNotes', built: true, appKey: 'sales.invoicing', permission: 'delivery_notes.view' },
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
    appKey: 'sales.pos',
    items: POS_SIDEBAR_LAUNCH_ITEMS.map((item) => ({
      ...item,
      icon: POS_NAV_ICONS[item.key],
      built: true,
      ...(item.key === 'posAudit' ? { permission: 'pos.audit.view' } : {}),
    })),
  },
  {
    title: 'customers',
    icon: Users,
    items: [
      { href: '/partners', icon: Users, key: 'customersManage', built: true },
      { href: '/partners/new', icon: UserPlus, key: 'customerCreate', built: true },
      { href: '/appointments', icon: CalendarCheck, key: 'appointments', built: true },
      { href: '/contacts', icon: Contact, key: 'contactList', built: true },
      { href: '/crm', icon: Handshake, key: 'crm', built: true, appKey: 'crm.follow_up' },
      { href: '/customer-settings', icon: SlidersHorizontal, key: 'customerSettings', built: true },
    ],
  },
  {
    title: 'inventory',
    icon: Boxes,
    items: [
      { href: '/products', icon: Package, key: 'products', built: true },
      { href: '/inventory', icon: Warehouse, key: 'stockBalances', built: true, appKey: 'inventory.core' },
      { href: '/warehouses', icon: Boxes, key: 'warehouses', built: true, appKey: 'inventory.core' },
      { href: '/stock-permits', icon: ClipboardCheck, key: 'stockPermits', built: true, appKey: 'inventory.core' },
      { href: '/stocktaking', icon: Warehouse, key: 'stocktaking', built: true, appKey: 'inventory.core' },
      { href: '/inventory-openings', icon: PackagePlus, key: 'inventoryOpenings', built: true, appKey: 'inventory.core' },
      { href: '/inventory-settings', icon: SlidersHorizontal, key: 'inventorySettings', built: true },
    ],
  },
  {
    // المشتريات — مجموعة مستقلّة (كانت أقسامها مبعثرة تحت المخزون).
    // المجموعة مكتملة: عشرة أقسام مبنيّة.
    title: 'purchases',
    icon: ShoppingCart,
    appKey: 'purchases.cycle',
    items: [
      { href: '/purchase-requests', icon: ClipboardList, key: 'purchaseRequests', built: true },
      { href: '/rfq', icon: FileQuestion, key: 'rfq', built: true },
      { href: '/purchase-quotes', icon: FileText, key: 'purchaseQuotes', built: true },
      { href: '/purchase-orders', icon: ClipboardCheck, key: 'purchaseOrders', built: true },
      { href: '/purchases', icon: Receipt, key: 'purchaseInvoices', built: true },
      { href: '/purchase-returns', icon: Undo2, key: 'purchaseReturns', built: true },
      { href: '/debit-notes', icon: FileMinus, key: 'debitNotes', built: true },
      { href: '/suppliers', icon: Handshake, key: 'suppliers', built: true },
      { href: '/supplier-payments', icon: CreditCard, key: 'supplierPayments', built: true },
      { href: '/purchase-settings', icon: SlidersHorizontal, key: 'purchaseSettings', built: true },
    ],
  },
  {
    title: 'accounting',
    icon: BookOpen,
    items: [
      { href: '/accounts', icon: BookOpen, key: 'accounts', built: true },
      { href: '/journal-entries', icon: ScrollText, key: 'manualJournals', built: true },
      { href: '/assets', icon: Building2, key: 'assets', built: true },
      { href: '/cost-centers', icon: Network, key: 'costCenters', built: true },
      { href: '/cheques', icon: ScrollText, key: 'cheques' },
    ],
  },
  {
    title: 'finance',
    icon: Banknote,
    items: [
      { href: '/expenses', icon: Receipt, key: 'expenses', built: true, appKey: 'finance.operations' },
      { href: '/receipt-vouchers', icon: FileText, key: 'receiptVouchers', built: true },
      { href: '/cash-and-bank', icon: Building2, key: 'cashAndBank', built: true },
      { href: '/employee-custodies', icon: Users, key: 'employeeCustodies', built: true, appKey: 'finance.operations' },
      { href: '/finance-settings', icon: SlidersHorizontal, key: 'financeSettings', built: true },
    ],
  },
  {
    title: 'hr',
    icon: UserCog,
    appKey: 'hr.employees',
    items: [
      { href: '/hr', icon: UserCog, key: 'employees', built: true },
      // الأربعة التالية تبويبات داخل /hr نفسها، لا صفحات مستقلة — التوجيه
      // بمعامل ?tab يفتحها مباشرة (كانت روابط منفصلة تؤدي إلى 404).
      { href: '/hr?tab=attendance', icon: Fingerprint, key: 'attendance', built: true },
      { href: '/hr?tab=runs', icon: Banknote, key: 'payroll', built: true },
      // لا تبويب "كل العقود" مستقلاً — العقود تفصيلية لكل موظف، فالرابط
      // يفتح قائمة الموظفين ليختار المستخدم ثم يفتح تبويب عقوده.
      { href: '/hr', icon: FileSignature, key: 'contracts', built: true },
      { href: '/hr?tab=requests', icon: Inbox, key: 'requests', built: true },
    ],
  },
  {
    title: 'operations',
    icon: Workflow,
    items: [
      {
        href: '/documents',
        icon: FileText,
        key: 'documentCenter',
        built: true,
        appKey: 'document_center.core',
        permission: 'documents.center.view',
      },
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
    // الشريط إرشادي فقط؛ مسار Workspace محروس مستقلاً بالاستحقاق التجاري
    // المركب وRBAC. appKey هنا يمنع إظهار رابط قدرة معطلة تشغيلياً.
    title: 'fuelStations',
    icon: Fuel,
    appKey: 'fuel_stations.core',
    // مدخل واحد للمساحة المتخصصة؛ الملاحة التشغيلية التفصيلية داخل Fuel Workspace.
    // تبقى حالة التطبيق هنا للعرض فقط، بينما كل API محروس مستقلاً في الخلفية.
    items: [
      { href: '/fuel-stations', icon: Fuel, key: 'fuelStationsWorkspace', built: true },
    ],
  },
  {
    // الفروع — عنصر مستقلّ (إدارة/إضافة/إعدادات)، منفصل عن مبدّل الفرع النشط
    // في قائمة المستخدم بالشريط العلوي.
    title: 'branches',
    icon: Network,
    appKey: 'company.branches',
    items: [
      { href: '/branches', icon: MapPin, key: 'branchesManage', built: true },
      { href: '/branches/new', icon: MapPinPlus, key: 'branchAdd', built: true },
      { href: '/branches/settings', icon: SlidersHorizontal, key: 'branchSettings', built: true },
    ],
  },
  {
    title: 'settings',
    icon: Settings,
    items: [
      { href: '/reports', icon: BarChart3, key: 'reports', built: true },
      { href: '/document-design', icon: LayoutTemplate, key: 'documentDesign', built: true },
      { href: '/numbering-settings', icon: Hash, key: 'numberingSettings', built: true },
      { href: '/tax-settings', icon: ReceiptText, key: 'taxSettings', built: true },
      { href: '/payment-methods', icon: WalletCards, key: 'paymentMethods', built: true },
      { href: '/applications', icon: LayoutGrid, key: 'applications', built: true },
      { href: '/settings', icon: Settings, key: 'accountSettings', built: true },
    ],
  },
  {
    // المطورون — مساحة تكامل من الدرجة الأولى داخل أَوْج المصادَق. تُخفى كاملةً لمن
    // لا يملك `developer.view` (المالك/المدير افتراضياً)، فلا يظهر رأسٌ بلا عناصر.
    // بلا appKey: ليست في كتالوج التطبيقات — الحراسة صلاحيةٌ لا استحقاق تجاري.
    title: 'developer',
    icon: Terminal,
    permission: 'developer.view',
    items: [
      { href: '/developer', icon: Compass, key: 'devOverview', built: true },
      { href: '/developer/keys', icon: KeyRound, key: 'devKeys', built: true },
      { href: '/developer/docs', icon: BookText, key: 'devDocs', built: true },
      { href: '/developer/webhooks', icon: Webhook, key: 'devWebhooks', built: true },
      { href: '/developer/security', icon: ShieldCheck, key: 'devSecurity', built: true },
    ],
  },
];

/**
 * تجميع المجموعات الاثنتي عشرة تحت عناوين خافتة.
 *
 * اثنا عشر عنواناً متتابعاً بلا فاصل تقرؤها العين قائمةً واحدة طويلة؛ والعنوان
 * الخافت يقسمها إلى أربع كتل تُمسَح بنظرة. **هو عنوان لا زرّ**: لا يُفتح ولا
 * يُطوى ولا يُنقر — وإلا صار مستوى ثالثاً في شجرة عمقُها اثنان يكفيان.
 *
 * التغطية كاملة بلا بقايا: ٣ + ٤ + ٣ + ٣ = ١٣.
 */
const SUPER_GROUPS: { label: string; titles: string[] }[] = [
  { label: 'revenue', titles: ['sales', 'pos', 'customers'] },
  { label: 'operations', titles: ['inventory', 'purchases', 'logistics', 'fuelStations'] },
  { label: 'finance', titles: ['accounting', 'finance', 'hr', 'operations'] },
  { label: 'admin', titles: ['branches', 'settings', 'developer'] },
];

export function Sidebar({
  open,
  onClose,
  onDismiss,
  collapsed = false,
  onToggleCollapse,
}: {
  open: boolean;
  onClose: () => void;
  /** يغلق درج الجوال ويعيد التركيز إلى زر القائمة الذي فتحه. */
  onDismiss: () => void;
  /** مطويّ: أيقونات فقط بعرض ضيّق. لا يُطبَّق إلا على الشاشات الواسعة. */
  collapsed?: boolean;
  onToggleCollapse?: () => void;
}) {
  const pathname = usePathname();
  const t = useTranslations('nav');
  const [isMobileViewport, setIsMobileViewport] = useState(false);
  const closeButtonRef = useRef<HTMLButtonElement>(null);

  // الدرج على الجوال يعرض القائمة كاملة دائماً — الطيّ ميزة شاشات واسعة.
  // فحين يكون الدرج مفتوحاً يسقط الطيّ، ولا يبقى المستخدم أمام أيقونات صمّاء.
  const mini = collapsed && !open;
  const drawerHiddenOnMobile = isMobileViewport && !open;

  // بيانات الشركة للعلامة في الترويسة — من `/me` القائم بلا طلب إضافي.
  const company = useCompany();

  // مفاتيح القدرات المُعطَّلة اليوم لهذا المستأجر — تُخفي عنصر/مجموعة الشريط
  // المرتبطة بها. مسار بلا صلاحية `apps.view` عمداً: كل الأدوار تحتاج هذه
  // القائمة لتصحيح تنقّلها، لا المالك/المدير وحدهما. فشل الجلب لا يُخفي شيئاً
  // — أسلم من إخفاء الشريط كلّه بخطأ شبكة عابر.
  const [hiddenAppKeys, setHiddenAppKeys] = useState<Set<string>>(new Set());
  useEffect(() => {
    let cancelled = false;
    api<{ data: Record<string, boolean> }>('/applications/nav-state')
      .then((res) => {
        if (cancelled || Array.isArray(res.data)) return;
        setHiddenAppKeys(hiddenApplicationKeys(res.data));
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, []);

  const user = currentUser();
  const groupHidden = (group: NavGroup) => !isNavEntryVisible({ appKey: group.appKey, permission: group.permission }, hiddenAppKeys, user);
  const visibleItems = (group: NavGroup) =>
    group.items.filter((item) => isNavEntryVisible(item, hiddenAppKeys, user));

  // المجموعة التي انبثقت قائمتها في الحالة المطوية (flyout)، وموضعها الرأسي.
  const [flyout, setFlyout] = useState<{ title: string; top: number } | null>(null);
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // يتابع شرط `lg` نفسه الذي يحوّل الدرج إلى شريط ثابت؛ فلا يُعزل شريط سطح المكتب.
  useEffect(() => {
    const mediaQuery = window.matchMedia('(max-width: 1023px)');
    const syncViewport = () => setIsMobileViewport(mediaQuery.matches);
    syncViewport();
    mediaQuery.addEventListener('change', syncViewport);
    return () => mediaQuery.removeEventListener('change', syncViewport);
  }, []);

  // الطيّ يُلغي أي قائمة منبثقة معلّقة — وإلا بقيت طافية بلا مرساة.
  useEffect(() => {
    if (!mini) setFlyout(null);
  }, [mini]);

  // عند فتح الدرج على الجوال يبدأ مسار لوحة المفاتيح بزر الإغلاق الظاهر.
  useEffect(() => {
    if (open && isMobileViewport) {
      requestAnimationFrame(() => closeButtonRef.current?.focus());
    }
  }, [open, isMobileViewport]);

  // Escape يعامل كإغلاق صريح ويعيد التركيز إلى الزر الذي فتح الدرج.
  useEffect(() => {
    if (!open || !isMobileViewport) return;
    const dismissOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onDismiss();
    };
    document.addEventListener('keydown', dismissOnEscape);
    return () => document.removeEventListener('keydown', dismissOnEscape);
  }, [isMobileViewport, onDismiss, open]);

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

  // نمط Accordion حصري: مجموعة واحدة مفتوحة **كحدّ أقصى** — والطيّ اليدوي
  // يجعلها صفراً. الافتراضي = مجموعة الصفحة الحالية فقط؛ وعند مسار خارج
  // المجموعات كاللوحة تبقى كلها مطوية. القيمة الفارغة تعني «الكلّ مطويّ».
  const [openGroup, setOpenGroup] = useState<string>(activeGroup ?? '');

  // التنقّل لصفحة في مجموعة أخرى (رابط مباشر/بحث) يفتحها تلقائياً ويُغلق سواها.
  useEffect(() => {
    if (activeGroup) setOpenGroup(activeGroup);
  }, [activeGroup]);

  /**
   * فتح حصري + طيّ يدوي:
   *  • النقر على مجموعة مغلقة يفتحها **ويغلق سواها** (مجموعة واحدة كحدّ أقصى).
   *  • والنقر على المفتوحة **يطويها** فلا تبقى مجموعة مفتوحة إطلاقاً.
   *
   * الطيّ اليدوي لا يُنقَض بعده: `useEffect` أعلاه يعتمد على `activeGroup`
   * وحده، فطيّ مجموعة الصفحة الحالية لا يُعيد فتحها ما دام المستخدم فيها —
   * ولو اعتمد على `openGroup` لانقلب الطيّ فتحاً فورياً وبدا الزرّ معطّلاً.
   */
  const toggleGroup = (title: string) =>
    setOpenGroup((current) => (current === title ? '' : title));

  return (
    <>
      {/* خلفية معتمة على الجوال عند فتح الدرج */}
      {open && <div className="fixed inset-0 z-40 bg-black/50 lg:hidden" onClick={onDismiss} aria-hidden />}

      <aside
        aria-hidden={drawerHiddenOnMobile || undefined}
        inert={drawerHiddenOnMobile}
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
          {/* شعار الشركة بدل الحرف الثابت — والحرف احتياطٌ حين لا شعار. */}
          <CompanyLogoMark logo={company?.logo} name={company?.name} size={mini ? 'sm' : 'md'} />
          {!mini && (
            <span className="truncate text-sm font-semibold text-text">{company?.name ?? 'نبراس'}</span>
          )}

          <button
            type="button"
            onClick={onDismiss}
            aria-label={t('close')}
            ref={closeButtonRef}
            className="ms-auto flex h-11 w-11 shrink-0 items-center justify-center rounded text-muted hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 lg:hidden"
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
                'hidden h-11 w-11 shrink-0 items-center justify-center rounded text-muted hover:bg-primary-soft hover:text-primary lg:flex',
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
            aria-current={isActive('/dashboard') ? 'page' : undefined}
            onClick={onClose}
            title={mini ? t('dashboard') : undefined}
            className={cn(
              'relative mb-3 flex h-11 items-center rounded text-sm text-muted hover:bg-primary-soft hover:text-primary',
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

          {SUPER_GROUPS.map((sg) => (
            <div key={sg.label}>
              {/* عنوان المجموعة: خافت وصغير، بلا زخرفة ولا حدّ — يفصل بالفراغ
                  والوزن لا بخطّ. ويختفي في الحالة المطوية: لا عرض لنصّ فيها. */}
              {!mini && (
                <div className="px-4 pb-1.5 pt-3.5 text-[11px] font-bold tracking-wide text-muted/70">
                  {t(`superGroups.${sg.label}`)}
                </div>
              )}

              {sg.titles.map((title) => {
            const group = GROUPS.find((g) => g.title === title);
            if (!group || groupHidden(group)) return null;
            const items = visibleItems(group);
            // Accordion حصري: المجموعة مفتوحة فقط إن كانت هي المجموعة النشطة الوحيدة.
            const expanded = openGroup === group.title;
            const GroupIcon = group.icon;
            // في الحالة المطوية لا عنوان يُبرز النشاط، فتحمله الأيقونة نفسها.
            const groupActive = items.some((it) => isActive(it.href));

            return (
              <div key={group.title} className="mb-1">
                <button
                  type="button"
                  onClick={(e) => (mini ? openFlyout(group.title, e.currentTarget) : toggleGroup(group.title))}
                  onMouseEnter={(e) => mini && openFlyout(group.title, e.currentTarget)}
                  onMouseLeave={() => mini && scheduleClose()}
                  onFocus={(e) => mini && openFlyout(group.title, e.currentTarget)}
                  aria-expanded={mini ? flyout?.title === group.title : expanded}
                  aria-haspopup={mini ? 'menu' : undefined}
                  title={mini ? t(`groups.${group.title}`) : undefined}
                  className={cn(
                    'relative flex h-11 w-full items-center rounded text-[14.5px] font-medium transition-colors',
                    'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
                    mini ? 'justify-center px-0' : 'gap-2 px-2',
                    groupActive || (mini && flyout?.title === group.title)
                      ? 'bg-primary-soft text-primary'
                      : 'text-muted hover:bg-primary-soft hover:text-primary'
                  )}
                >
                  {/* الخطّ الجانبي ٣px يرافق الخلفية على **الرئيسي النشط وحده** —
                      فيبقى للفرع النشط تمييزُ اللون والوزن بلا خلفية تنافسه. */}
                  {groupActive && !mini && (
                    <span aria-hidden className="absolute inset-y-1.5 start-0 w-[3px] rounded bg-primary" />
                  )}
                  <GroupIcon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.7} />
                  {!mini && (
                    <>
                      <span className="min-w-0 flex-1 truncate text-start">{t(`groups.${group.title}`)}</span>
                      {/* سهم واحد يدور بدل عنصرين يتبادلان — الدوران وحده يقبل
                          الانتقال، والاستبدال يقفز بلا حركة. */}
                      <ChevronDown
                        className={cn(
                          'h-4 w-4 shrink-0 transition-transform duration-150',
                          expanded ? 'rotate-0' : 'ltr:-rotate-90 rtl:rotate-90'
                        )}
                        strokeWidth={1.8}
                      />
                    </>
                  )}
                </button>

                {/* عرض شرطي: عناصر المجموعة المفتوحة فقط (Accordion حصري) — يُخفّف الـ DOM
                    ويلغي تحريك grid-template-rows الثقيل؛ ظهور سلس على الـ compositor. */}
                {/* الإزاحة والخطّ الفاصل على الحاوية لا على كل رابط: خطٌّ متصل
                    واحد يربط الفروع بأبيها، بدل خطوط مقطّعة بينها فجوات. */}
                {expanded && !mini && (
                  <div className="sidebar-group-in ms-[29px] flex flex-col gap-0.5 border-s border-border ps-2 pt-0.5">
                    {items.map((item) => {
                      const Icon = item.icon;
                      const active = isActive(item.href);
                      return (
                        <Link
                          key={item.key}
                          href={item.href}
                          {...posNavNewTabAnchorProps(item.openInNewTab)}
                          aria-current={active ? 'page' : undefined}
                          onClick={onClose}
                          className={cn(
                            // الفرع أصغر وأخفت من أبيه — والنشِط يتميّز باللون
                            // والوزن **بلا خلفية**: `primary-soft` للرئيسي وحده،
                            // ولو أخذها الفرع لتساويا في الوزن البصري.
                            'flex h-11 items-center gap-2 rounded pe-2 ps-2 text-[13px] text-muted transition-colors hover:text-primary',
                            active && 'font-semibold text-primary'
                          )}
                        >
                          <Icon className="h-[15px] w-[15px] shrink-0" strokeWidth={1.7} />
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
            </div>
          ))}
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
          {(() => {
            const flyoutGroup = GROUPS.find((g) => g.title === flyout.title);
            return flyoutGroup ? visibleItems(flyoutGroup) : [];
          })().map((item) => {
            const Icon = item.icon;
            const active = isActive(item.href);
            return (
              <Link
                key={item.key}
                href={item.href}
                {...posNavNewTabAnchorProps(item.openInNewTab)}
                role="menuitem"
                aria-current={active ? 'page' : undefined}
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
