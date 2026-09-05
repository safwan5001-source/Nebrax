'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useLocale, useTranslations } from 'next-intl';
import {
  Search, Barcode, Star, Package, Plus, X,
  User, UserPlus, StickyNote, LayoutGrid, ShoppingCart,
  Users, MoreHorizontal, PauseCircle, Archive, Trash,
} from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { PosDialog } from '@/components/pos/pos-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api';
import { logout } from '@/lib/auth';
import { POS_RETURN_HREF, POS_START_HREF, decidePosUnsavedExit } from '@/lib/pos-workspace';
import {
  POS_CART_FAB_CLASS,
  POS_CART_PAY_FOOTER_CLASS,
  POS_DESKTOP_CATEGORIES_CLASS,
  POS_MOBILE_NAV_CLASS,
  POS_PRODUCTS_PANEL_CLASS,
  POS_SALE_GRID_CLASS,
  posCartPaneClass,
  posProductGridClass,
  posProductGridPadClass,
  posProductsPaneClass,
} from '@/lib/pos-responsive';
import { formatRiyal, riyalToMinor, extractInclusiveTax } from '@/lib/money';
import { getSystemTaxInclusive } from '@/lib/tax';
import { useBranches } from '@/lib/branch';
import type { Warehouse } from '@/lib/warehouse';
import { ReceiptDialog, type Receipt } from '@/components/pos/receipt-dialog';
import { PosTopbar } from '@/components/pos/pos-topbar';
import { PosRecentInvoicesDialog } from '@/components/pos/pos-recent-invoices-dialog';
import { PosCategoryImage } from '@/components/pos/pos-category-image';
import { cartHasUnsavedData, createPosActiveCart, usePosActiveCarts, type PosCartLine } from '@/components/pos/use-pos-active-carts';
import { PosShortcuts } from '@/components/pos/pos-shortcuts';
import { PosPayment, type PaymentSummaryItem, type PosPaymentMethod, type PosTender } from '@/components/pos/pos-payment';
import { PosExchangeDialog } from '@/components/pos/pos-exchange-dialog';
import { PosHeldSalesDialog, type PosHeldSale } from '@/components/pos/pos-held-sales-dialog';
import { PosReturnDialog } from '@/components/pos/pos-return-dialog';
import { PosNumericEditor } from '@/components/pos/pos-numeric-editor';
import { PosProductTile } from '@/components/pos/pos-product-tile';
import { PosCartEmptyState, PosCartLineFrame, PosCartQtyControls, PosCartRemoveButton } from '@/components/pos/pos-cart-line-controls';
import { CustomerPickerDialog, type PosCustomer } from '@/components/pos/customer-picker';
import { PosAuditReasonDialog } from '@/components/pos/pos-audit-reason-dialog';
import { buildInvoiceDocumentModel, type SourceInvoice, type SourceCompany } from '@/modules/documents/builder/from-invoice';
import type { LiveTemplateRevision } from '@/modules/print-templates/services/live-template-definition';
import { usePosBarcodeScanner } from '@/components/pos/interactions/use-pos-barcode-scanner';
import { usePosCartLineSelection, usePosCartNavigation } from '@/components/pos/interactions/use-pos-cart-navigation';
import { usePosFocusManager } from '@/components/pos/interactions/use-pos-focus-manager';
import { usePosKeyboardActive } from '@/components/pos/interactions/use-pos-keyboard-active';
import { usePosKeyboardShortcuts } from '@/components/pos/interactions/use-pos-keyboard-shortcuts';
import { isPosDialogOpen, type PosDialogFlags } from '@/components/pos/interactions/pos-interaction-context';
import { usePosProductNavigation, usePosProductSelection, usePosSearchFieldNavigation } from '@/components/pos/interactions/use-pos-product-navigation';
import { appendPosCartProduct, matchPosBarcode } from '@/lib/pos-barcode';
import { POS_FEEDBACK_DEFAULTS, posSound, type PosFeedbackSettings, type PosSoundEvent } from '@/lib/pos-sound';
import { runPosCheckout } from '@/lib/pos-checkout';
import {
  PosCheckoutAttemptController,
  isPosCheckoutNetworkFailure,
  type PosCheckoutPhase,
} from '@/lib/pos-checkout-attempt';
import { buildPosReceiptInvoice, posReceiptCustomer, type PosCheckoutInvoiceLine } from '@/lib/pos-receipt';
import {
  buildPosCartSnapshotScope,
  buildPosCartStorageKey,
  markSaleClearedSync,
  snapshotHasRestorableWork,
} from '@/lib/pos-cart-snapshot';
import { usePosNetworkStatus } from '@/lib/pos-network-status';
import {
  parsePosInteractionMode,
  posInteractionViewportFromMedia,
  resolvePosInteractionPolicy,
  type PosInteractionMode,
  type PosInteractionViewport,
} from '@/lib/pos-interaction-policy';
import { resolvePosDefaultCustomer } from '@/lib/pos-default-customer';
import { executeCashDrawerAction, type CashDrawerAction, type CashDrawerBridgeResult } from '@/lib/cash-drawer-bridge';
import { hasPermission } from '@/lib/permissions';
import { PosProductQuickView, type PosProductQuickViewProduct } from '@/components/pos/pos-product-quick-view';

const WALKIN = 'عميل نقدي (POS)';

/** إعدادات نقطة البيع (sales-config/pos) — تُطبَّق فعلياً على تدفّق البيع. */
interface PosConfig extends PosFeedbackSettings {
  default_customer_id: string | null;
  default_customer: string;
  receipt_footer: string;
  print_receipt: boolean;
  receipt_paper_size: 'thermal_58' | 'thermal_80';
  allow_discount: boolean;
  apply_customer_price_list: boolean;
  allow_unit_price_override: boolean;
  show_onscreen_numeric_keypad: boolean;
  interaction_mode: PosInteractionMode;
  held_sale_close_policy: 'discard_on_session_close' | 'keep_for_next_session';
  enabled_payment_method_ids: string[];
  payment_methods_mode: 'all_active' | 'only' | 'none';
  default_payment_method_id: string | null;
  allow_deferred_payment: boolean;
  show_product_images: boolean;
  cash_drawer_enabled: boolean;
  cash_drawer_driver: string;
  cash_drawer_auto_open_after_cash: boolean;
  blind_cash_count_enabled: boolean;
}
const POS_DEFAULTS: PosConfig = {
  default_customer_id: null,
  default_customer: WALKIN,
  receipt_footer: '',
  print_receipt: true,
  receipt_paper_size: 'thermal_80',
  allow_discount: true,
  apply_customer_price_list: true,
  allow_unit_price_override: false,
  // لم تكن لوحة أرقام مساعدة في الكاشير سابقاً؛ نبقيها معطلة حتى يختارها المالك صراحةً.
  show_onscreen_numeric_keypad: false,
  interaction_mode: 'AUTO',
  held_sale_close_policy: 'discard_on_session_close',
  enabled_payment_method_ids: [],
  payment_methods_mode: 'all_active',
  default_payment_method_id: null,
  allow_deferred_payment: true,
  show_product_images: true,
  cash_drawer_enabled: false,
  cash_drawer_driver: 'unavailable',
  cash_drawer_auto_open_after_cash: false,
  blind_cash_count_enabled: false,
  ...POS_FEEDBACK_DEFAULTS,
};

interface PosUnit { name: string; factor: number; price: string }
interface PosBarcode { code: string; unit_name: string; default_quantity: number }
interface Product {
  id: string;
  sku: string | null;
  barcode: string | null;
  name: string;
  sale_price: string;
  pos_units: PosUnit[];
  pos_barcodes: PosBarcode[];
  pos_image?: { download_url: string } | null;
  category_id: string | null;
  category: string | null;
  category_image?: { download_url: string } | null;
  tax_rate: number;
  type: string;
  track_inventory: boolean;
  quantity_on_hand: number;
  is_active: boolean;
  /** حد إعادة الطلب — نفس عتبة «مخزون منخفض» المعتمدة في قائمة المنتجات
   *  (`ProductListFilters`): `quantity_on_hand <= reorder_level` و`reorder_level > 0`. */
  reorder_level?: number | null;
}
interface PosDevice { id: string; name: string; code: string | null; warehouse_id: string; is_active: boolean; warehouse?: { id: string; code: string; name: string } | null; cash_drawer?: { configured: boolean } }
interface PosSession { id: string; number: string; status: string; pos_device_id?: string | null; warehouse_id?: string | null; shift_id?: string | null; pos_device?: { id: string; name: string; code: string | null } | null; warehouse?: { id: string; code: string; name: string } | null }
/**
 * R5: يطابق حرفياً ما يعيده `InvoiceResource` بعد `POS/checkout` — الفاتورة
 * المرحّلة الفعلية، لا افتراضاً محلياً. الإيصال الفوري يُبنى من هذا الشكل
 * وحده (عبر `buildPosReceiptInvoice`)؛ لا يُعاد اشتقاق أي رقم مالي من سلة
 * العميل بعد نجاح الإتمام.
 */
interface PosCheckoutResponse {
  data: {
    id: string;
    number: string;
    invoice_date: string;
    payment_type: string;
    payment_status?: string | null;
    status?: string | null;
    subtotal: string;
    discount?: string;
    shipping?: string;
    adjustment?: string;
    tax_amount: string;
    total: string;
    notes: string | null;
    partner?: { id: string; name: string; vat_number: string | null; city: string | null } | null;
    zatca?: { qr: string | null } | null;
    lines: PosCheckoutInvoiceLine[];
    thermal_template_revision?: LiveTemplateRevision | null;
  };
  cash_drawer_action?: CashDrawerAction;
  idempotent_replay?: boolean;
}

const FAV_KEY = 'nibras_pos_favs';

export default function PosPage() {
  const t = useTranslations('pos');
  const tc = useTranslations('common');
  const tprod = useTranslations('products');
  const locale = useLocale();
  const rtl = locale === 'ar';
  const router = useRouter();
  const { success, error: errorToast, toast } = useToast();
  const focusManager = usePosFocusManager();
  const {
    registerSearchInput,
    registerProductsContainer,
    registerProductButton,
    registerCartContainer,
    registerCartLine,
    activeZone,
    focusSearch,
    focusZone,
    restoreFocusSafe,
  } = focusManager;
  const { keyboardActive, lastInput, onPointerDown, onKeyDown: onKeyboardActiveKeyDown, markScanner, restoreAfterUi } = usePosKeyboardActive();
  const [desktopKeyboardNav, setDesktopKeyboardNav] = useState(false);
  const [viewport, setViewport] = useState<PosInteractionViewport>('desktop');
  useEffect(() => {
    const desktop = window.matchMedia('(min-width: 1024px)');
    const tablet = window.matchMedia('(min-width: 768px)');
    const sync = () => {
      setDesktopKeyboardNav(desktop.matches);
      setViewport(posInteractionViewportFromMedia(desktop.matches, tablet.matches));
    };
    sync();
    desktop.addEventListener('change', sync);
    tablet.addEventListener('change', sync);
    return () => {
      desktop.removeEventListener('change', sync);
      tablet.removeEventListener('change', sync);
    };
  }, []);

  const [products, setProducts] = useState<Product[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [cashier, setCashier] = useState('—');
  const [cashierScope, setCashierScope] = useState<{ userId: string; tenantId: string }>({ userId: '', tenantId: '' });
  // Quick View «فتح في ERP»: يُقرَّر من صلاحية الخادم نفسها (`/me`) لا بتخمين
  // واجهة — يطابق فحص `products.view` الذي تحرسه صفحة `/products/{id}` نفسها.
  const [canOpenProductInErp, setCanOpenProductInErp] = useState(false);
  const [companyName, setCompanyName] = useState('—');
  // الفرع المعروض: الفرع النشط (افتراضه الرئيسي)، وإلا اسم الشركة.
  const { active: activeBranch } = useBranches();
  const branch = activeBranch?.name ?? companyName;
  const [company, setCompany] = useState<SourceCompany | null>(null);
  const [search, setSearch] = useState('');
  const [cat, setCat] = useState('all');
  const [tab, setTab] = useState('all');
  const [favs, setFavs] = useState<Set<string>>(new Set());
  /** Quick View: معرّف المنتج المعروض فقط — قراءة بحتة، لا تمسّ السلة أو العميل أو الجلسة. */
  const [quickViewProductId, setQuickViewProductId] = useState<string | null>(null);
  const [priceErrors, setPriceErrors] = useState<Record<string, string>>({});
  const [step, setStep] = useState<'sale' | 'payment'>('sale');
  const [mobileTab, setMobileTab] = useState<'products' | 'cart'>('products');
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [checkoutPhase, setCheckoutPhase] = useState<PosCheckoutPhase>('idle');
  const paymentRequestRef = useRef(false);
  const checkoutAttemptRef = useRef(new PosCheckoutAttemptController());
  const auditCartRequestRef = useRef(new Map<string, Promise<string>>());
  const [posCfg, setPosCfg] = useState<PosConfig>(POS_DEFAULTS);
  const interactionMode = parsePosInteractionMode(posCfg.interaction_mode);
  const policy = resolvePosInteractionPolicy(interactionMode, { viewport, lastModality: lastInput });
  const restoreFocusAfterUi = useCallback(() => {
    if (!policy.restoreKeyboardFocus) return false;
    return restoreAfterUi(restoreFocusSafe);
  }, [policy.restoreKeyboardFocus, restoreAfterUi, restoreFocusSafe]);
  const keyboardNavEnabled = desktopKeyboardNav && interactionMode !== 'TOUCH';
  const [paymentMethods, setPaymentMethods] = useState<PosPaymentMethod[]>([]);
  const [paymentMethodsLoading, setPaymentMethodsLoading] = useState(true);
  const [paymentMethodsError, setPaymentMethodsError] = useState<string | null>(null);
  // وضع الضريبة من إعدادات النظام (متضمَّن/غير متضمَّن) — يوحّد سلوك كل المعاملات.
  const [systemTaxInclusive, setSystemTaxInclusive] = useState(false);
  // الوردية (الجلسة النقدية) — تُربط بالبيع: تُفتح قبل البيع وتُغلق بعدّ النقد.
  const [session, setSession] = useState<PosSession | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [sessionInvalid, setSessionInvalid] = useState(false);
  const [sessionRevalidating, setSessionRevalidating] = useState(false);
  const [devices, setDevices] = useState<PosDevice[]>([]);
  const [closeOpen, setCloseOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [exchangeOpen, setExchangeOpen] = useState(false);
  const [countedBal, setCountedBal] = useState('');
  const [sessionBusy, setSessionBusy] = useState(false);
  const [drawerBusy, setDrawerBusy] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const ts = useTranslations('posSessions');
  const online = usePosNetworkStatus();
  const restoreNoticeKeyRef = useRef<string | null>(null);

  const cartSnapshotScope = session && cashierScope.userId && cashierScope.tenantId
    ? buildPosCartSnapshotScope({
      tenantId: cashierScope.tenantId,
      userId: cashierScope.userId,
      branchId: activeBranch?.id ?? null,
      session,
    })
    : null;
  const activeCartStorageKey = cartSnapshotScope ? buildPosCartStorageKey(cartSnapshotScope) : null;
  const {
    carts, activeCart, activeCartId, hydrated, restoreStatus, pendingAttempt,
    setActiveCartId, patchActive, updateActiveItems, updateCarts,
    openCart, createCart, closeCart, setPendingAttempt, applyClearedSaleState,
  } = usePosActiveCarts({
    storageKey: activeCartStorageKey,
    scope: cartSnapshotScope,
    defaultTaxInclusive: systemTaxInclusive,
  });
  const cart = activeCart.items;
  const selectedCustomer = activeCart.customer;
  const taxInclusive = activeCart.taxInclusive;
  const setCart = useCallback((updater: PosCartLine[] | ((current: PosCartLine[]) => PosCartLine[])) => {
    updateActiveItems((current) => typeof updater === 'function' ? updater(current) : updater);
  }, [updateActiveItems]);
  const ensureAuditCart = useCallback(async (cartState = activeCart): Promise<string | null> => {
    if (!session) return null;
    if (cartState.auditCartId) return cartState.auditCartId;
    const pending = auditCartRequestRef.current.get(cartState.id);
    if (pending) return pending;
    const request = api<{ data: { cart_id: string } }>('/pos/carts', {
      method: 'POST',
      body: { pos_session_id: session.id, snapshot: { items: cartState.items, customer: cartState.customer, note: cartState.note, tax_inclusive: cartState.taxInclusive } },
    }).then((created) => {
      updateCarts((current) => current.map((entry) => entry.id === cartState.id ? { ...entry, auditCartId: created.data.cart_id } : entry));
      return created.data.cart_id;
    }).finally(() => { auditCartRequestRef.current.delete(cartState.id); });
    auditCartRequestRef.current.set(cartState.id, request);
    return request;
  }, [activeCart, session, updateCarts]);
  const recordCartForensics = useCallback(async (type: string, data: Record<string, unknown>, cartState = activeCart) => {
    if (!session) return null;
    const auditCartId = await ensureAuditCart(cartState);
    if (!auditCartId) return null;
    return api(`/pos/carts/${auditCartId}/events`, { method: 'POST', body: { pos_session_id: session.id, type, ...data } });
  }, [activeCart, ensureAuditCart, session]);
  const setSelectedCustomer = useCallback((customer: PosCustomer | null) => {
    const before = activeCart.customer ? { id: activeCart.customer.id, name: activeCart.customer.name } : null;
    const after = customer ? { id: customer.id, name: customer.name } : null;
    patchActive({ customer });
    if (before?.id !== after?.id) void recordCartForensics('customer_changed', { before: { customer: before }, after: { customer: after }, customer: after });
  }, [activeCart, patchActive, recordCartForensics]);
  const setTaxInclusive = useCallback((value: boolean) => patchActive({ taxInclusive: value }), [patchActive]);
  // العميل المختار مرجع حقيقي؛ قد تبقى السلة بلا مرجع حتى يختار الكاشير عميلاً مسجلاً قبل التحصيل.
  const [pickerOpen, setPickerOpen] = useState(false);
  const [heldCount, setHeldCount] = useState(0);
  const [holdBusy, setHoldBusy] = useState(false);
  const [retrieveOpen, setRetrieveOpen] = useState(false);
  const [recentInvoicesOpen, setRecentInvoicesOpen] = useState(false);
  const [openCartsOpen, setOpenCartsOpen] = useState(false);
  const [cartToClose, setCartToClose] = useState<string | null>(null);
  const [clearCartOpen, setClearCartOpen] = useState(false);
  const [noteOpen, setNoteOpen] = useState(false);
  const [sensitiveAction, setSensitiveAction] = useState<{ type: 'item_removed' | 'cart_cancelled' | 'payment_cancelled'; line?: PosCartLine; cartId: string } | null>(null);
  const [sensitiveBusy, setSensitiveBusy] = useState(false);
  const [unsavedExitAction, setUnsavedExitAction] = useState<'close_session' | 'logout' | 'return_to_system' | null>(null);
  const [lastScannedLineKey, setLastScannedLineKey] = useState<string | null>(null);
  const [scanFeedbackMessage, setScanFeedbackMessage] = useState('');
  const numericEditorLabels = {
    apply: t('numeric_keypad_apply'),
    backspace: t('numeric_keypad_backspace'),
    cancel: t('numeric_keypad_cancel'),
    clear: t('numeric_keypad_clear'),
    decimal: t('numeric_keypad_decimal'),
    digit: (digit: string) => t('numeric_keypad_digit', { digit }),
    value: t('numeric_keypad_value'),
  };

  const dialogFlags = useMemo<PosDialogFlags>(() => ({
    pickerOpen,
    retrieveOpen,
    returnOpen,
    exchangeOpen,
    recentInvoicesOpen,
    openCartsOpen,
    clearCartOpen,
    noteOpen,
    sensitiveActionOpen: sensitiveAction !== null,
    closeOpen,
    unsavedExitOpen: unsavedExitAction !== null,
    sessionGateOpen: sessionReady && !session,
  }), [
    pickerOpen, retrieveOpen, returnOpen, exchangeOpen, recentInvoicesOpen,
    openCartsOpen, clearCartOpen, noteOpen, sensitiveAction, closeOpen,
    unsavedExitAction, sessionReady, session,
  ]);
  const dialogOpen = isPosDialogOpen(dialogFlags);

  // اسم إعداد العميل الافتراضي يبقى fallback لاسم مرجع صحيح فقط؛ غياب المرجع ظاهر ويطلب اختياراً صريحاً قبل التحصيل.
  useEffect(() => {
    updateCarts((current) => current.map((cartState) => (
      cartState.items.length === 0 && cartState.customer === null && cartState.note.trim() === ''
        ? { ...cartState, taxInclusive: systemTaxInclusive }
        : cartState
    )));
  }, [systemTaxInclusive, updateCarts]);

  const walkinName = posCfg.default_customer?.trim() || WALKIN;
  const customerName = selectedCustomer?.name ?? t('select_customer');
  const playPosFeedback = useCallback((event: PosSoundEvent) => posSound.play(event, posCfg), [posCfg]);

  // العميل الافتراضي المُعدّ يصبح العميل المختار فعلياً عند بدء POS — لا مجرد
  // تسمية. المعرّف مرجع صالح داخل نطاق الفرع/المستأجر الحالي لأن الخادم يعيد
  // حلّه ويعيده null إن لم يكن كذلك، فلا تسريب ولا إنشاء صامت. يُطبَّق مرة واحدة
  // لكل جلسة تخزين، بعد استقرار الاستعادة من التخزين، وعلى سلة نظيفة فقط: فلا
  // يكتب فوق اختيار يدوي ولا فوق عميل سلة معلّقة مستأنفة.
  const defaultCustomerKeyRef = useRef<string | null>(null);
  useEffect(() => {
    if (!hydrated || !activeCartStorageKey) return;
    if (defaultCustomerKeyRef.current === activeCartStorageKey) return;
    const defaultCustomer = resolvePosDefaultCustomer(posCfg, walkinName);
    if (!defaultCustomer) return; // لم تصل الإعدادات بعد أو لا مرجع صالح → يبقى الاختيار للمستخدم قبل التحصيل
    defaultCustomerKeyRef.current = activeCartStorageKey;
    if (!cartHasUnsavedData(activeCart)) {
      setSelectedCustomer(defaultCustomer);
    }
  }, [hydrated, activeCartStorageKey, posCfg, walkinName, activeCart, setSelectedCustomer]);

  // إشعار خفيف مرة واحدة لكل مفتاح تخزين عند استعادة سلة غير فارغة — بلا modal مزعج.
  useEffect(() => {
    if (!hydrated || !activeCartStorageKey) return;
    if (restoreNoticeKeyRef.current === activeCartStorageKey) return;
    restoreNoticeKeyRef.current = activeCartStorageKey;
    if (restoreStatus === 'restored' && snapshotHasRestorableWork(carts)) {
      success(t('cart_restored'));
    } else if (restoreStatus === 'ignored_stale' || restoreStatus === 'ignored_invalid' || restoreStatus === 'ignored_scope') {
      toast({ title: t('cart_snapshot_ignored'), variant: 'warning' });
    }
  }, [hydrated, activeCartStorageKey, restoreStatus, carts, success, t, toast]);

  const revalidateSession = useCallback(async () => {
    if (!online) return;
    setSessionRevalidating(true);
    try {
      const r = await api<{ data: PosSession[] }>('/pos-sessions?mine=1');
      const current = r.data.find((item) => item.status === 'open') ?? null;
      if (!current) {
        if (session) {
          setSessionInvalid(true);
          setSession(null);
          setStep('sale');
          setCheckoutPhase('idle');
          checkoutAttemptRef.current.reset();
          setPaying(false);
          paymentRequestRef.current = false;
        }
        return;
      }
      setSessionInvalid(false);
      setSession((prev) => {
        if (prev?.id === current.id) return prev;
        return current;
      });
      if (current.warehouse_id) setWarehouseId(current.warehouse_id);
    } catch {
      // فشل الاستطلاع لا يُفترض إغلاقاً؛ نبقي الحالة الحالية.
    } finally {
      setSessionRevalidating(false);
    }
  }, [online, session]);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === 'visible') void revalidateSession();
    };
    const onOnline = () => { void revalidateSession(); };
    document.addEventListener('visibilitychange', onVisibility);
    window.addEventListener('online', onOnline);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
      window.removeEventListener('online', onOnline);
    };
  }, [revalidateSession]);

  useEffect(() => {
    posSound.preload();
    const unlock = () => posSound.unlock();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);

  useEffect(() => {
    if (!lastScannedLineKey) return;
    const timer = window.setTimeout(() => setLastScannedLineKey(null), 700);
    return () => window.clearTimeout(timer);
  }, [lastScannedLineKey]);

  const loadProducts = useCallback(async (partnerId: string | null) => {
    const query = partnerId ? `?partner_id=${encodeURIComponent(partnerId)}` : '';
    setCatalogLoading(true);
    try {
      const result = await api<{ data: Product[] }>(`/pos/products${query}`);
      setProducts(result.data);
    } catch {
      // يبقى آخر كتالوج ظاهر عند فشل الشبكة؛ الإتمام يعيد فرض السعر الخادمي.
    } finally {
      setCatalogLoading(false);
    }
  }, []);

  useEffect(() => {
    void loadProducts(selectedCustomer?.id ?? null);
  }, [loadProducts, selectedCustomer?.id]);

  // عندما تتغير قائمة العميل، تصير أسعار الكتالوج الجديد مصدر عرض السلة أيضاً.
  // الحارس الخادمي يفرض القيمة نفسها عند الإتمام، فلا يكون التغيير واجهة فقط.
  useEffect(() => {
    if (!posCfg.apply_customer_price_list || products.length === 0) return;
    updateCarts((current) => current.map((cartState) => {
      const partnerId = cartState.customer?.id ?? null;
      // الكتالوج الجاري يخص العميل النشط فقط؛ لا نعيد تسعير سلة عميل آخر صامتاً.
      if (partnerId !== selectedCustomer?.id) return cartState;
      let changed = false;
      const items = cartState.items.map((line) => {
        if (line.productId === null) return line;
        const price = products.find((product) => product.id === line.productId)?.sale_price;
        if (!price || price === line.price) return line;
        changed = true;
        return { ...line, price };
      });
      return changed ? { ...cartState, items } : cartState;
    }));
  }, [posCfg.apply_customer_price_list, products, selectedCustomer?.id, updateCarts]);

  useEffect(() => {
    api<{ data: Warehouse[] }>('/warehouses').then((r) => {
      const active = r.data.filter((warehouse) => warehouse.is_active);
      setWarehouses(active);
      setWarehouseId((current) => current || active.find((warehouse) => warehouse.is_default)?.id || active[0]?.id || '');
    }).catch(() => {});
    api<{ user?: { id?: string; tenant_id?: string; name?: string; role?: string; permissions?: string[] }; company?: { name?: string; vat_number?: string | null; cr_number?: string | null } }>('/me')
      .then((r) => {
        setCashier(r.user?.name ?? t('cashier'));
        setCashierScope({ userId: r.user?.id ?? '', tenantId: r.user?.tenant_id ?? '' });
        setCompanyName(r.company?.name ?? t('main_branch'));
        if (r.company) setCompany({ name: r.company.name ?? '—', vat_number: r.company.vat_number ?? null, cr_number: r.company.cr_number ?? null });
        setCanOpenProductInErp(hasPermission(r.user?.permissions, r.user?.role, 'products.view'));
      })
      .catch(() => {});
    api<{ data: Partial<PosConfig> }>('/sales-config/pos')
      .then((r) => setPosCfg({
        ...POS_DEFAULTS,
        ...r.data,
        interaction_mode: parsePosInteractionMode(r.data.interaction_mode),
      }))
      .catch(() => {});
    api<{ data: PosPaymentMethod[] }>('/payment-methods')
      .then((r) => setPaymentMethods(r.data.filter((method) => method.is_active)))
      .catch((err) => setPaymentMethodsError(err instanceof ApiError ? err.message : tc('loadFailed')))
      .finally(() => setPaymentMethodsLoading(false));
    getSystemTaxInclusive().then(setSystemTaxInclusive).catch(() => {});
    api<{ data: PosDevice[] }>('/pos-devices').then((r) => setDevices(r.data.filter((device) => device.is_active))).catch(() => {});
    // الجلسة المفتوحة الحالية (إن وُجدت) تُتبنّى هنا. بلا جلسة تُحوَّل الصفحة
    // إلى `/pos/start` — لا بوابة HR shift_id داخل شاشة البيع.
    api<{ data: PosSession[] }>('/pos-sessions?mine=1')
      .then((r) => {
        const current = r.data.find((item) => item.status === 'open') ?? null;
        setSession(current);
        if (current?.warehouse_id) setWarehouseId(current.warehouse_id);
      })
      .catch(() => {})
      .finally(() => setSessionReady(true));
    try {
      const raw = localStorage.getItem(FAV_KEY);
      if (raw) setFavs(new Set(JSON.parse(raw)));
    } catch { /* ignore */ }
  }, [t, tc]);

  useEffect(() => {
    if (!sessionReady || session) return;
    router.replace(sessionInvalid ? `${POS_START_HREF}?reason=closed` : POS_START_HREF);
  }, [router, session, sessionInvalid, sessionReady]);

  const toggleFav = useCallback((id: string) => {
    setFavs((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      try { localStorage.setItem(FAV_KEY, JSON.stringify([...next])); } catch { /* ignore */ }
      return next;
    });
  }, []);

  const availablePaymentMethods = useMemo(() => {
    if (posCfg.payment_methods_mode === 'none') return [];
    const enabled = posCfg.enabled_payment_method_ids;
    return paymentMethods.filter((method) => posCfg.payment_methods_mode === 'all_active' || enabled.includes(method.id));
  }, [paymentMethods, posCfg.enabled_payment_method_ids, posCfg.payment_methods_mode]);
  const sessionDrawerConfigured = !!session?.pos_device_id
    && devices.some((device) => device.id === session.pos_device_id && device.cash_drawer?.configured === true);

  // قد تصل الإعدادات بعد أن يبدأ الكاشير سلةً مؤقتة؛ لا نترك خصماً معروضاً
  // أو محفوظاً عندما تكون السياسة الخادمية قد أوقفته.
  useEffect(() => {
    if (posCfg.allow_discount) return;
    updateCarts((current) => current.map((cartState) => (
      cartState.items.some((line) => riyalToMinor(line.discount) > 0)
        ? { ...cartState, items: cartState.items.map((line) => ({ ...line, discount: '' })) }
        : cartState
    )));
  }, [posCfg.allow_discount, updateCarts]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (cat !== 'all' && p.category_id !== cat) return false;
      if (tab === 'favorites' && !favs.has(p.id)) return false;
      // الباركود يُبحث فيه كتابةً لا مسحاً فقط: `scanCode` أدناه يطابق الكود
      // **كاملاً**، فمن يقرأ رقماً عن العبوة ويكتب آخره لا يجد شيئاً.
      if (
        q
        && !p.name.toLowerCase().includes(q)
        && !(p.sku ?? '').toLowerCase().includes(q)
        && !(p.barcode ?? '').toLowerCase().includes(q)
      ) return false;
      return true;
    });
  }, [products, search, cat, tab, favs]);

  const { selectedIndex, setSelectedIndex } = usePosProductSelection(filtered.length);
  const { selectedLineKey, setSelectedLineKey } = usePosCartLineSelection(
    cart.map((line) => ({ key: line.key })),
    false,
  );
  const productElementsRef = useRef<Map<number, HTMLButtonElement>>(new Map());

  function pricedUnit(product: Product, unitName: string | null): PosUnit | undefined {
    return product.pos_units.find((unit) => unit.name === unitName) ?? product.pos_units[0];
  }

  function effectiveLinePrice(line: PosCartLine): string {
    if (posCfg.allow_unit_price_override || line.productId === null) {
      return line.price;
    }

    const product = products.find((item) => item.id === line.productId);
    return product ? pricedUnit(product, line.unit)?.price ?? line.price : line.price;
  }

  // لا تبقى سلة قديمة أو مستأنفة بوحدة أو سعر لم يعدا في كتالوج العميل. يعيد
  // السطر إلى أول وحدة مسعّرة (الأساس دائماً) عند وصول الكتالوج أو الإعداد.
  useEffect(() => {
    if (posCfg.allow_unit_price_override || products.length === 0) return;
    updateCarts((current) => current.map((cartState) => ({
      ...cartState,
      items: cartState.items.map((line) => {
        if (line.productId === null) return line;
        const product = products.find((item) => item.id === line.productId);
        const unit = product ? pricedUnit(product, line.unit) : undefined;
        return unit && (unit.name !== line.unit || unit.price !== line.price)
          ? { ...line, unit: unit.name, price: unit.price }
          : line;
      }),
    })));
  }, [posCfg.allow_unit_price_override, products, updateCarts]);

  function addProduct(p: Product, unitName: string | null = null, quantity = 1): string | null {
    const unit = pricedUnit(p, unitName);
    if (!unit) return null;
    const lineKey = `${p.id}:${unit.name}`;
    const before = cart.find((line) => line.key === lineKey);
    setCart((current) => appendPosCartProduct(current, p, unit, quantity));
    void recordCartForensics('item_added', {
      item: { product_id: p.id, description: p.name, sku: p.sku, quantity, unit: unit.name, unit_price: riyalToMinor(unit.price) },
      before: { item: before ? auditLine(before) : null }, after: { item: { product_id: p.id, quantity: (before?.qty ?? 0) + quantity, unit: unit.name } },
    });
    return lineKey;
  }

  const setUnit = (key: string, unitName: string) => {
    const before = cart.find((line) => line.key === key);
    setCart((current) => {
      const line = current.find((item) => item.key === key);
      if (!line || line.productId === null) return current;
      const product = products.find((item) => item.id === line.productId);
      const unit = product?.pos_units.find((item) => item.name === unitName);
      if (!unit || unit.name === line.unit) return current;

      const sameUnit = current.find((item) => item.key !== key && item.productId === line.productId && item.unit === unit.name);
      if (sameUnit) {
        return current
          .filter((item) => item.key !== key)
          .map((item) => item.key === sameUnit.key ? { ...item, qty: item.qty + line.qty } : item);
      }

      return current.map((item) => item.key === key
        ? { ...item, key: `${line.productId}:${unit.name}`, unit: unit.name, price: unit.price }
        : item);
    });
    if (before) void recordCartForensics('item_quantity_changed', { before: { item: auditLine(before) }, after: { item: { ...auditLine(before), unit: unitName } } });
  };
  const setQty = (k: string, d: number) => {
    const before = cart.find((line) => line.key === k);
    if (!before) return;
    const after = { ...before, qty: Math.max(1, before.qty + d) };
    setCart((c) => c.map((line) => line.key === k ? after : line));
    if (after.qty !== before.qty) void recordCartForensics('item_quantity_changed', { before: { item: auditLine(before) }, after: { item: auditLine(after) } });
  };
  const setQtyFromInput = (k: string, value: string) => {
    if (!/^\d+$/.test(value)) return;
    const quantity = Number(value);
    if (!Number.isSafeInteger(quantity) || quantity < 1) return;
    const before = cart.find((line) => line.key === k);
    if (!before || before.qty === quantity) return;
    const after = { ...before, qty: quantity };
    setCart((current) => current.map((line) => line.key === k ? after : line));
    void recordCartForensics('item_quantity_changed', { before: { item: auditLine(before) }, after: { item: auditLine(after) } });
  };
  const setDiscount = (k: string, v: string) => {
    if (!posCfg.allow_discount) return;
    const before = cart.find((line) => line.key === k);
    setCart((c) => c.map((l) => (l.key === k ? { ...l, discount: v } : l)));
    if (before && before.discount !== v) void recordCartForensics('discount_changed', { reason_code: 'wrong_price', item: auditLine(before), before: { item: auditLine(before) }, after: { item: { ...auditLine(before), discount: riyalToMinor(v) } } });
  };
  const setUnitPrice = (k: string, v: string) => {
    if (!posCfg.allow_unit_price_override) return;
    setPriceErrors((current) => {
      const { [k]: _cleared, ...rest } = current;
      return rest;
    });
    const before = cart.find((line) => line.key === k);
    setCart((c) => c.map((l) => (l.key === k ? { ...l, price: v } : l)));
    if (before && before.price !== v) void recordCartForensics('price_overridden', { reason_code: 'wrong_price', item: auditLine(before), before: { item: auditLine(before) }, after: { item: { ...auditLine(before), unit_price: riyalToMinor(v) } } });
  };
  const normalizeUnitPrice = (k: string, value?: string) => {
    const line = cart.find((current) => current.key === k);
    if (!line) return;

    const price = value ?? line.price;
    const minor = riyalToMinor(price);
    if (Number.isFinite(minor) && minor >= 0) {
      setPriceErrors((current) => {
        const { [k]: _cleared, ...rest } = current;
        return rest;
      });
      setCart((current) => current.map((item) => (item.key === k ? { ...item, price: (minor / 100).toFixed(2) } : item)));
      return;
    }

    const message = t('unit_price_invalid');
    setPriceErrors((current) => ({ ...current, [k]: message }));
    errorToast(message);
    const product = products.find((item) => item.id === line.productId);
    const fallback = product ? pricedUnit(product, line.unit)?.price ?? '0.00' : '0.00';
    setCart((current) => current.map((item) => (item.key === k ? { ...item, price: fallback } : item)));
  };
  const remove = (k: string) => {
    const line = cart.find((entry) => entry.key === k);
    if (line) setSensitiveAction({ type: 'item_removed', line, cartId: activeCart.id });
  };

  // عدد المسودات قراءة تشغيلية فقط؛ فتح الحوار يعيد تحميل القائمة الكاملة من الخادم.
  const refreshHeldCount = useCallback(async () => {
    if (!session?.id) { setHeldCount(0); return; }
    try {
      const result = await api<{ data: PosHeldSale[] }>(`/pos/held-sales?pos_session_id=${encodeURIComponent(session.id)}`);
      setHeldCount(result.data.length);
    } catch { setHeldCount(0); }
  }, [session?.id]);
  useEffect(() => { void refreshHeldCount(); }, [refreshHeldCount]);

  function drawerMessage(result: CashDrawerBridgeResult): string {
    if (result.status === 'bridge_unavailable') return t('cash_drawer_bridge_unavailable');
    if (result.status === 'printer_unavailable') return t('cash_drawer_printer_unavailable');
    if (result.status === 'not_configured' || result.status === 'unsupported') return t('cash_drawer_not_configured');
    if (result.status === 'permission_denied') return t('cash_drawer_permission_denied');
    return t('cash_drawer_open_failed');
  }

  function resultFromApiError(error: unknown): CashDrawerBridgeResult | null {
    const body = error instanceof ApiError ? error.body : null;
    const data = typeof body === 'object' && body !== null && 'data' in body
      ? (body as { data?: unknown }).data
      : null;
    return typeof data === 'object' && data !== null && 'status' in data
      ? data as CashDrawerBridgeResult
      : null;
  }

  async function settleDrawerAction(action: CashDrawerAction): Promise<CashDrawerBridgeResult> {
    if (!session) return { status: 'not_configured', error_code: 'pos_session_missing' };
    const settle = async (path: string, body: Record<string, unknown>) => {
      try {
        return (await api<{ data: CashDrawerBridgeResult }>(path, { method: 'POST', body })).data;
      } catch (error) {
        const result = resultFromApiError(error);
        if (result) return result;
        throw error;
      }
    };
    return executeCashDrawerAction(
      action,
      (actionId, result) => settle(`/pos-sessions/${session.id}/cash-drawer/complete`, { action_id: actionId, result }),
      (actionId) => settle(`/pos-sessions/${session.id}/cash-drawer/unavailable`, { action_id: actionId }),
    );
  }

  async function openCashDrawer() {
    if (!session || !sessionDrawerConfigured || !posCfg.cash_drawer_enabled || posCfg.cash_drawer_driver === 'unavailable') {
      errorToast(t('cash_drawer_unavailable'));
      return;
    }
    setDrawerBusy(true);
    try {
      let action: CashDrawerAction;
      try {
        action = (await api<{ data: CashDrawerAction }>(`/pos-sessions/${session.id}/cash-drawer/open`, {
          method: 'POST', body: { reason: t('cash_drawer_manual_reason') },
        })).data;
      } catch (error) {
        const result = resultFromApiError(error);
        if (result) {
          errorToast(drawerMessage(result));
          return;
        }
        throw error;
      }
      const result = await settleDrawerAction(action);
      if (result.status === 'opened') success(t('cash_drawer_opened'));
      else errorToast(drawerMessage(result));
    } catch (err) {
      errorToast(err instanceof ApiError ? err.message : t('cash_drawer_open_failed'));
    } finally {
      setDrawerBusy(false);
    }
  }

  // تعليق السلة الخادمي: لا فاتورة ولا قبض ولا قيد ولا حركة مخزون قبل الدفع.
  async function holdSale() {
    if (catalogLoading) {
      errorToast(t('price_list_loading'));
      return;
    }
    if (cart.length === 0 || !session) {
      if (!session) errorToast(t('open_to_start'));
      return;
    }
    setHoldBusy(true);
    try {
      const auditCartId = await ensureAuditCart(activeCart);
      if (!auditCartId) throw new Error(t('open_to_start'));
      await api('/pos/held-sales', {
        method: 'POST',
        body: {
          pos_session_id: session.id,
          cart_id: auditCartId,
          customer_id: selectedCustomer?.id ?? null,
          tax_inclusive: taxInclusive,
          items: cart.map((line) => ({
            product_id: line.productId,
            description: line.description,
            sku: line.sku,
            quantity: line.qty,
            unit: line.unit,
            unit_price: riyalToMinor(effectiveLinePrice(line)),
            tax_rate: line.tax,
            discount: posCfg.allow_discount ? lineCalc(line).disc : 0,
          })),
        },
      });
      closeCart(activeCart.id);
      setHeldCount((current) => current + 1);
      success(t('held_done'));
      restoreFocusAfterUi();
    } catch (err) {
      errorToast(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setHoldBusy(false);
    }
  }

  function retrieveSale(held: PosHeldSale) {
    const nextNumber = Math.max(0, ...carts.map((cartState) => cartState.number)) + 1;
    const restored = createPosActiveCart(nextNumber, held.tax_inclusive);
    restored.auditCartId = held.cart_id ?? null;
    restored.items = held.items.map((item, index) => ({
      key: `${restored.id}:${held.id}-${index}`,
      productId: item.product_id,
      description: item.description ?? '—',
      sku: item.sku,
      unit: item.unit,
      price: posCfg.allow_unit_price_override
        ? item.unit_price
        : (() => {
          const product = products.find((entry) => entry.id === item.product_id);
          return product ? pricedUnit(product, item.unit)?.price ?? item.unit_price : item.unit_price;
        })(),
      qty: item.quantity,
      tax: item.tax_rate,
      discount: posCfg.allow_discount ? item.discount : '',
    }));
    restored.customer = held.customer;
    openCart(restored);
    setRetrieveOpen(false);
    setStep('sale');
    setMobileTab('cart');
    setHeldCount((current) => Math.max(0, current - 1));
    success(t('held_resumed'));
    restoreFocusAfterUi();
  }

  // مسح باركود: الأساسي/SKU يبيع وحدة الأساس، أما البديل فيحمل وحدته من
  // كتالوج POS المسعّر؛ فلا يتحول مسح كرتون غير مسعّر إلى بيع قطعة بصمت.
  function scanCode(code: string): boolean {
    const normalizedCode = code.trim();
    if (!normalizedCode) return false;

    try {
      const match = matchPosBarcode(products, normalizedCode);
      if (!match) {
        errorToast(t('scan_not_found', { code: normalizedCode }));
        playPosFeedback('scan_not_found');
        return false;
      }

      const lineKey = addProduct(match.product, match.unitName, match.quantity);
      if (!lineKey) {
        errorToast(t('scan_error'));
        playPosFeedback('scan_error');
        return false;
      }

      // لا Toast نجاح متكرر عند المسح السريع؛ السطر المضاف يضيء مؤقتاً وتبقى
      // رسالة حية قصيرة لقارئات الشاشة.
      setLastScannedLineKey(lineKey);
      setScanFeedbackMessage(t('scan_added', { name: match.product.name }));
      playPosFeedback('scan_success');
      return true;
    } catch {
      errorToast(t('scan_error'));
      playPosFeedback('scan_error');
      return false;
    }
  }

  usePosBarcodeScanner({
    onScan: scanCode,
    enabled: policy.scannerEnabled && step === 'sale' && !dialogOpen,
    onScannerActivity: markScanner,
  });

  const handleSearchKeyDown = usePosSearchFieldNavigation({
    onMoveToProducts: () => {
      setSelectedIndex(0);
      focusZone('products', { productIndex: 0 });
    },
    onExitSearch: () => focusZone('search'),
  });

  usePosKeyboardShortcuts({
    customer: () => setPickerOpen(true),
    search: focusSearch,
    heldSales: () => setRetrieveOpen(true),
    holdSale: () => { void holdSale(); },
    delete: () => {
      const key = selectedLineKey ?? cart[cart.length - 1]?.key;
      if (key) remove(key);
    },
    payment: () => {
      if (cart.length > 0 && step === 'sale' && !sessionInvalid && online) {
        if (pendingAttempt?.cartId === activeCart.id) {
          checkoutAttemptRef.current.adopt(pendingAttempt.attemptId);
        }
        setStep('payment');
      }
    },
    newCart: () => { createCart(); },
    openCarts: () => setOpenCartsOpen(true),
    back: step === 'payment' ? requestPaymentCancel : undefined,
  }, { step, dialogFlags });

  usePosProductNavigation({
    enabled: keyboardNavEnabled,
    rtl,
    step,
    dialogOpen,
    activeZone,
    products: filtered,
    getProductElement: (index) => productElementsRef.current.get(index) ?? null,
    onSelectIndex: setSelectedIndex,
    selectedIndex,
    onAddProduct: (product) => { addProduct(product); },
    onEnterCartZone: () => {
      const lastKey = cart[cart.length - 1]?.key;
      if (lastKey) {
        setSelectedLineKey(lastKey);
        focusZone('cart', { cartLineKey: lastKey });
      } else {
        focusZone('cart');
      }
    },
    focusManager,
  });

  usePosCartNavigation({
    enabled: keyboardNavEnabled,
    step,
    dialogOpen,
    activeZone,
    lines: cart.map((line) => ({ key: line.key })),
    selectedLineKey,
    onSelectLineKey: setSelectedLineKey,
    onAdjustQty: (lineKey, delta) => setQty(lineKey, delta),
    onRemoveLine: remove,
    onEnterProductsZone: () => {
      setSelectedIndex(0);
      focusZone('products', { productIndex: 0 });
    },
    focusManager,
  });

  // حساب السطر حسب وضع الضريبة والخصم: الخصم يقلّل الأساس قبل الضريبة (مطابق للـ backend).
  const lineCalc = (l: PosCartLine) => {
    const gross = l.qty * riyalToMinor(effectiveLinePrice(l));
    const raw = riyalToMinor(l.discount);
    const disc = Number.isFinite(raw) ? Math.min(Math.max(0, raw), gross) : 0;
    const discounted = gross - disc;
    if (taxInclusive) {
      const tax = extractInclusiveTax(discounted, l.tax);
      return { gross, disc, net: discounted - tax, tax, total: discounted };
    }
    const tax = Math.round((discounted * l.tax) / 100);
    return { gross, disc, net: discounted, tax, total: discounted + tax };
  };

  // الإجماليات مشتقّة من حساب السطور (مصدر الحقيقة) — تطابق ما يرحّله الخادم.
  const { subMinor, taxMinor, totalMinor, discMinor } = cart.reduce(
    (acc, l) => {
      const c = lineCalc(l);
      acc.subMinor += c.net;
      acc.taxMinor += c.tax;
      acc.totalMinor += c.total;
      acc.discMinor += c.disc;
      return acc;
    },
    { subMinor: 0, taxMinor: 0, totalMinor: 0, discMinor: 0 },
  );
  const count = cart.reduce((s, l) => s + l.qty, 0);

  async function finishCloseSession() {
    if (!session) return;
    setSessionBusy(true);
    setSessionError(null);
    try {
      await api(`/pos-sessions/${session.id}/close`, {
        method: 'POST',
        body: { closing_balance: riyalToMinor(countedBal) },
      });
      router.push('/dashboard'); // الوردية أُغلقت — نغادر نقطة البيع
    } catch (err) {
      setSessionError(err instanceof ApiError ? err.message : tc('saveFailed'));
      setSessionBusy(false);
    }
  }

  function closeSession(e: React.FormEvent) {
    e.preventDefault();
    if (!session) return;
    if (decidePosUnsavedExit(carts.some(cartHasUnsavedData)) === 'guard') {
      setUnsavedExitAction('close_session');
      return;
    }
    void finishCloseSession();
  }

  function requestLogout() {
    if (decidePosUnsavedExit(carts.some(cartHasUnsavedData)) === 'guard') {
      setUnsavedExitAction('logout');
      return;
    }
    void finishLogout();
  }

  function requestReturnToSystem() {
    if (decidePosUnsavedExit(carts.some(cartHasUnsavedData)) === 'guard') {
      setUnsavedExitAction('return_to_system');
      return;
    }
    finishReturnToSystem();
  }

  function finishReturnToSystem() {
    router.push(POS_RETURN_HREF);
  }

  async function finishLogout() {
    await logout();
    router.replace('/login');
  }

  async function confirmUnsavedExit() {
    const action = unsavedExitAction;
    setUnsavedExitAction(null);
    if (action === 'close_session') await finishCloseSession();
    if (action === 'logout') await finishLogout();
    if (action === 'return_to_system') finishReturnToSystem();
  }

  const confirmPayment = useCallback(
    async (tenders: PosTender[]) => {
      if (!online) {
        setError(t('checkout_offline_blocked'));
        playPosFeedback('warning');
        return;
      }
      if (sessionInvalid || !session) {
        setError(sessionInvalid ? t('session_closed_remote') : t('open_to_start'));
        playPosFeedback('warning');
        return;
      }
      if (catalogLoading) {
        setError(t('price_list_loading'));
        playPosFeedback('warning');
        return;
      }
      if (cart.length === 0) return;
      const customer = selectedCustomer;
      if (!customer) {
        setError(t('customer_required_for_payment'));
        setPickerOpen(true);
        playPosFeedback('warning');
        return;
      }
      if (paymentRequestRef.current) return;
      paymentRequestRef.current = true;
      setPaying(true);
      setCheckoutPhase('submitting');
      setError(null);
      // إعادة استخدام مفتاح محاولة محفوظة لنفس السلة (PR-9 + عقد #559) — لا مفتاح عشوائي جديد.
      if (pendingAttempt?.cartId === activeCart.id) {
        checkoutAttemptRef.current.adopt(pendingAttempt.attemptId);
      }
      const attemptKey = checkoutAttemptRef.current.ensure();
      setPendingAttempt({ cartId: activeCart.id, attemptId: attemptKey, savedAt: Date.now() });
      let auditCartId: string | null = null;
      try {
        auditCartId = await ensureAuditCart(activeCart);
        if (!auditCartId) {
          setCheckoutPhase('retryable_error');
          setError(t('open_to_start'));
          playPosFeedback('payment_error');
          return;
        }

        const submitOnce = async () => {
          const items = cart.map((l) => ({
            product_id: l.productId,
            description: l.description,
            quantity: l.qty,
            unit: l.unit,
            unit_price: riyalToMinor(effectiveLinePrice(l)),
            tax_rate: l.tax,
            discount: posCfg.allow_discount ? lineCalc(l).disc : 0, // خصم السطر بالهللات (مقيَّد ≤ إجمالي السطر)
          }));
          // إتمام ذري: فاتورة مرحّلة ثم سند قبض لكل وسيلة مهيأة عبر المحرّكات المحاسبية.
          return api<PosCheckoutResponse>('/pos/checkout', {
            method: 'POST',
            body: {
              idempotency_key: attemptKey,
              partner_id: customer.id,
              pos_session_id: session.id,
              cart_id: auditCartId,
              warehouse_id: warehouseId || null,
              tax_inclusive: taxInclusive,
              notes: activeCart.note.trim() || null,
              items,
              tenders,
            },
          });
        };

        const submitWithRecovery = async () => {
          try {
            return await submitOnce();
          } catch (error) {
            // بعد timeout/انقطاع: لا نفترض الفشل — إعادة POST بنفس المفتاح آمنة خادمياً.
            if (!isPosCheckoutNetworkFailure(error)) throw error;
            setCheckoutPhase('recovering');
            setError(t('checkout_recovering'));
            return await submitOnce();
          }
        };

        const result = await runPosCheckout({
          submitCheckout: submitWithRecovery,
          // لحظة النجاح المالي هي استجابة checkout؛ نغلق السلة ونغادر شاشة الدفع
          // قبل انتظار QR، فلا تعود العملية قابلة لإرسال الدفع نفسه مرة ثانية.
          onCheckoutSuccess: (checkout) => {
            checkoutAttemptRef.current.resetAfterSuccess();
            setCheckoutPhase('success');
            // مسح sync فوري حتى لا تُستعاد السلة المباعة بعد reload قبل دورة React.
            if (activeCartStorageKey && cartSnapshotScope) {
              const cleared = markSaleClearedSync({
                storageKey: activeCartStorageKey,
                scope: cartSnapshotScope,
                carts,
                activeId: activeCartId,
                soldCartId: activeCart.id,
                defaultTaxInclusive: systemTaxInclusive,
              });
              applyClearedSaleState(cleared);
            } else {
              setPendingAttempt(null);
              closeCart(activeCart.id);
            }
            playPosFeedback('payment_success');
            if (checkout.idempotent_replay) {
              success(t('checkout_recovered_success'));
            }
            setStep('sale');
            setMobileTab('products');
            restoreFocusAfterUi();
            // عملية الدرج تبدأ بعد النجاح المالي والتنظيف؛ لا تنتظرها ولا تسمح
            // لخطئها بإعادة شاشة الدفع أو إظهار فشل للفاتورة المكتملة.
            const action = checkout.cash_drawer_action;
            if (action?.status === 'pending') {
              void settleDrawerAction(action).then((drawerResult) => {
                if (drawerResult.status !== 'opened') {
                  toast({ title: t('sale_done'), description: t('cash_drawer_automatic_warning'), variant: 'warning' });
                }
              }).catch(() => {
                toast({ title: t('sale_done'), description: t('cash_drawer_automatic_warning'), variant: 'warning' });
              });
            } else if (action && action.status !== 'opened') {
              toast({ title: t('sale_done'), description: t('cash_drawer_automatic_warning'), variant: 'warning' });
            }
          },
          // R5: رمز ZATCA يصل بالفعل ضمن ردّ checkout نفسه (`data.zatca.qr`) —
          // الفاتورة تُرحَّل وتُولَّد بيانات ZATCA لها ذرّياً قبل عودة الاستجابة،
          // فلا حاجة لطلب شبكة ثانٍ قد يفشل لسببٍ لا علاقة له بصحة الفاتورة.
          fetchQr: (created) => Promise.resolve({ qr: created.data.zatca?.qr ?? null }),
          onPaymentError: (error) => {
            // فشل الدفع يسجله PosService من مسار checkout نفسه بمصدر server؛
            // الواجهة تعرض النتيجة فقط ولا تنشئ دليلاً نهائياً قابلاً للتزوير.
            // نبقي نفس attemptKey لإعادة محاولة آمنة (الخادم يمنع التكرار).
            const network = isPosCheckoutNetworkFailure(error);
            setCheckoutPhase('retryable_error');
            const reason = network
              ? t('checkout_retry_safe')
              : error instanceof ApiError
                ? (error.status === 409 ? t('checkout_key_conflict') : error.message)
                : tc('saveFailed');
            setError(reason);
            playPosFeedback('payment_error');
          },
          onQrUnavailable: () => {
            toast({ title: t('sale_done'), description: t('zatca_qr_unavailable'), variant: 'warning' });
          },
        });

        if (result.status !== 'success' || !result.checkout) return;

        // R5: الإيصال الفوري يُبنى من الفاتورة المرحّلة التي أعادها الخادم —
        // نفس ما يعيده `GET /invoices/{id}` لاحقاً لإعادة الطباعة — لا من سلة
        // العميل المحلية. القيم المالية (الكمية/السعر/الضريبة/الإجماليات)
        // كلها من `created`؛ السلة المحلية لا تُستَشار إلا لعنصر عرضٍ بحت
        // (اسم الوحدة البديلة المختارة في واجهة الكاشير) لا يغيّر رقماً مالياً.
        // فشل نموذج الإيصال نفسه لا يعيد شاشة الدفع ولا يحول بيعاً مؤكداً إلى فشل.
        try {
          const created = result.checkout.data;
          const receiptInvoice = buildPosReceiptInvoice(created, cart.map((l) => l.unit));
          const model = buildInvoiceDocumentModel({
            invoice: receiptInvoice,
            company,
            customer: posReceiptCustomer(created, customer.name),
            qr: result.qr?.qr ?? null,
            footerText: posCfg.receipt_footer,
          });
          // التذييل يبقى من إعداد POS القائم، بينما المراجعة الحرارية المثبتة
          // تتحكم في هوية القالب/الثيمة/التخطيط. لا نعيد حلّ assignment حي بعد البيع.
          setReceipt({
            model,
            number: created.number,
            thermalTemplateRevision: created.thermal_template_revision ?? null,
          });
        } catch {
          toast({ title: t('sale_done'), description: t('receipt_unavailable'), variant: 'warning' });
        }
      } catch (error) {
        // فشل قبل/خارج مسار checkout (مثل إنشاء سلة التدقيق) — لا رفض غير معالَج.
        setCheckoutPhase('retryable_error');
        setError(
          isPosCheckoutNetworkFailure(error)
            ? t('checkout_retry_safe')
            : error instanceof ApiError
              ? error.message
              : error instanceof Error
                ? error.message
                : tc('saveFailed'),
        );
        playPosFeedback('payment_error');
      } finally {
        paymentRequestRef.current = false;
        setPaying(false);
        setCheckoutPhase((phase) => (phase === 'success' ? 'idle' : phase === 'submitting' || phase === 'recovering' ? 'idle' : phase));
      }
    },
    [activeCart, activeCartId, activeCartStorageKey, applyClearedSaleState, cart, cartSnapshotScope, carts, catalogLoading, closeCart, online, pendingAttempt, sessionInvalid, setPendingAttempt, success, systemTaxInclusive, t, tc, toast, selectedCustomer, posCfg.receipt_footer, posCfg.allow_discount, posCfg.allow_unit_price_override, taxInclusive, company, warehouseId, session, products, playPosFeedback, ensureAuditCart, totalMinor],
  );

  const summaryItems: PaymentSummaryItem[] = cart.map((l) => ({
    name: l.unit ? `${l.description} (${l.unit})` : l.description, qty: l.qty, unitPrice: formatRiyal(effectiveLinePrice(l)), lineTotal: lineCalc(l).total,
  }));

  const CATS = [
    { key: 'all', label: t('cat_all'), image: null as string | null, icon: LayoutGrid },
    ...Array.from(new Map(products
      .filter((product) => product.category_id && product.category)
      .map((product) => [product.category_id as string, {
        key: product.category_id as string,
        label: product.category as string,
        image: product.category_image?.download_url ?? null,
        icon: Package,
      }]))
      .values()),
  ];
  const TABS = [
    { key: 'all', label: t('tab_all'), icon: null },
    { key: 'favorites', label: t('tab_favorites'), icon: Star },
  ];

  // ── لوحات فرعية ──────────────────────────────────────────────
  const productsPanel = (
    <section className={POS_PRODUCTS_PANEL_CLASS}>
      <div className="flex gap-2">
        <button
          type="button"
          onClick={focusSearch}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-border bg-surface text-text hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          aria-label={t('barcode_search')}
        >
          <Barcode className="h-4 w-4" strokeWidth={1.7} />
        </button>
        <div className="flex h-11 flex-1 items-center gap-2 rounded-md border border-border bg-surface px-3 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
          <Search className="h-4 w-4 shrink-0 text-muted" strokeWidth={1.7} />
          <input
            ref={registerSearchInput}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              handleSearchKeyDown(e);
              if (e.defaultPrevented) return;
              if (e.key === 'Enter' && search.trim()) {
                e.preventDefault();
                if (scanCode(search.trim())) setSearch('');
              }
            }}
            placeholder={t('search_products')}
            className="min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-muted"
          />
          {policy.showShortcutHints ? (
            <kbd className="num hidden rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted lg:block">F4</kbd>
          ) : null}
        </div>
      </div>

      {/* تصنيفات POS على الجوال/التابلت: صور سريعة مع تمرير أفقي، ونفس الفلتر التشغيلي. */}
      <div className="-mx-3 flex flex-nowrap gap-2 overflow-x-auto px-3 pb-1 touch-pan-x sm:-mx-4 sm:px-4 lg:hidden" aria-label={t('categories')}>
        {CATS.map(({ key, label, image, icon: Icon }, index) => {
          const on = cat === key;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={on}
              onClick={() => setCat(key)}
              className={'flex w-[76px] shrink-0 touch-manipulation flex-col items-center gap-1.5 rounded-lg border p-2 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ' + (index === 0 ? 'ms-0 ' : '') + (index === CATS.length - 1 ? 'me-1 ' : '') + (on ? 'border-primary bg-primary-soft text-primary' : 'border-border bg-surface text-text')}
            >
              <span className="h-11 w-11 overflow-hidden rounded-md bg-background">
                {key === 'all' ? (
                  <span className="grid h-full w-full place-items-center bg-primary-soft text-primary"><Icon className="h-5 w-5" strokeWidth={1.7} /></span>
                ) : (
                  <PosCategoryImage path={image} alt={label} />
                )}
              </span>
              <span className="line-clamp-2 min-h-7 text-[10.5px] font-semibold leading-tight">{label}</span>
            </button>
          );
        })}
      </div>

      <div className="flex items-center gap-2">
        {TABS.map((qt) => {
          const Icon = qt.icon;
          const on = tab === qt.key;
          return (
            <button
              key={qt.key}
              type="button"
              onClick={() => setTab(qt.key)}
              className={'inline-flex min-h-11 items-center gap-1.5 rounded-md px-3 text-sm font-semibold touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ' + (on ? 'bg-primary-soft text-primary' : 'text-muted hover:bg-surface hover:text-text')}
            >
              {Icon && <Icon className="h-3.5 w-3.5" strokeWidth={1.7} />}
              {qt.label}
            </button>
          );
        })}
      </div>

      <div
        ref={registerProductsContainer}
        tabIndex={-1}
        className={posProductGridClass(posCfg.show_product_images, count > 0)}
      >
        {filtered.map((p, index) => {
          const tracked = p.track_inventory;
          const fav = favs.has(p.id);
          const productSelected = policy.allowKeyboardPowerMode && keyboardActive && activeZone === 'products' && selectedIndex === index;
          return (
            <PosProductTile
              key={p.id}
              product={{
                id: p.id,
                name: p.name,
                sku: p.sku,
                barcode: p.barcode,
                sale_price_label: formatRiyal(p.sale_price),
                pos_image: p.pos_image,
                track_inventory: tracked,
                quantity_on_hand: p.quantity_on_hand,
                reorder_level: p.reorder_level ?? null,
              }}
              showImage={posCfg.show_product_images}
              selected={productSelected}
              isFavorite={fav}
              availableLabel={t('available')}
              favoriteLabel={t('tab_favorites')}
              outOfStockLabel={t('out_of_stock')}
              lowStockLabel={t('low_stock')}
              quickViewLabel={t('quick_view')}
              onAdd={() => addProduct(p)}
              onToggleFavorite={() => toggleFav(p.id)}
              onOpenQuickView={() => setQuickViewProductId(p.id)}
              onFocus={() => {
                setSelectedIndex(index);
                focusZone('products', { productIndex: index });
              }}
              buttonRef={(element) => {
                registerProductButton(index, element);
                if (element) productElementsRef.current.set(index, element);
                else productElementsRef.current.delete(index);
              }}
            />
          );
        })}
        {filtered.length === 0 && <p className="col-span-full rounded-lg border border-dashed border-border bg-background py-10 text-center text-sm text-muted">{t('no_products')}</p>}
      </div>
    </section>
  );

  function requestCloseCart(cartId: string) {
    const target = carts.find((cartState) => cartState.id === cartId);
    if (!target) return;
    if (cartHasUnsavedData(target)) {
      setSensitiveAction({ type: 'cart_cancelled', cartId });
      return;
    }
    closeCart(cartId);
  }

  function confirmCloseCart() {
    if (cartToClose) requestCloseCart(cartToClose);
    setCartToClose(null);
  }

  function confirmClearActiveCart() {
    setClearCartOpen(false);
    if (cart.length > 0) setSensitiveAction({ type: 'cart_cancelled', cartId: activeCart.id });
  }

  function requestPaymentCancel() {
    if (paying) return;
    if (cart.length === 0) {
      checkoutAttemptRef.current.reset();
      setPendingAttempt(null);
      setCheckoutPhase('idle');
      setStep('sale');
      return;
    }
    setSensitiveAction({ type: 'payment_cancelled', cartId: activeCart.id });
  }

  const auditLine = (line: PosCartLine) => ({
    product_id: line.productId, description: line.description, sku: line.sku,
    quantity: line.qty, unit: line.unit, unit_price: riyalToMinor(line.price),
    tax_rate: line.tax, discount: riyalToMinor(line.discount),
  });

  async function confirmSensitiveAction(reason: { code: string; note: string }) {
    const action = sensitiveAction;
    const target = action ? carts.find((cartState) => cartState.id === action.cartId) : null;
    if (!action || !target) { setSensitiveAction(null); return; }
    setSensitiveBusy(true);
    try {
      if (action.type === 'item_removed' && action.line) {
        const before = auditLine(action.line);
        await recordCartForensics('item_removed', {
          reason_code: reason.code, reason_note: reason.note, item: before,
          before: { item: before }, after: { items: target.items.filter((line) => line.key !== action.line?.key).map(auditLine) },
        }, target);
        updateCarts((current) => current.map((cartState) => cartState.id === target.id
          ? { ...cartState, items: cartState.items.filter((line) => line.key !== action.line?.key) }
          : cartState));
      } else if (action.type === 'payment_cancelled') {
        await recordCartForensics('payment_cancelled', {
          reason_code: reason.code, reason_note: reason.note,
          before: { items: target.items.map(auditLine), customer: target.customer }, after: { status: 'cancelled' },
        }, target);
        checkoutAttemptRef.current.reset();
        setPendingAttempt(null);
        setCheckoutPhase('idle');
        setStep('sale');
        restoreFocusAfterUi();
      } else {
        await recordCartForensics('cart_cancelled', {
          reason_code: reason.code, reason_note: reason.note,
          before: { items: target.items.map(auditLine), customer: target.customer, note: target.note },
          after: { status: 'cancelled' },
        }, target);
        if (target.id === activeCart.id) {
          updateCarts((current) => current.map((cartState) => cartState.id === target.id
            ? { ...cartState, items: [], customer: null, note: '', taxInclusive: systemTaxInclusive }
            : cartState));
          setPriceErrors({});
        } else {
          closeCart(target.id);
        }
      }
      success(t('reasonSaved'));
      setSensitiveAction(null);
    } catch (err) {
      errorToast(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally { setSensitiveBusy(false); }
  }

  const cartPanel = (
    <aside className="flex min-h-0 flex-col overflow-hidden border-border bg-surface md:border-e">
      <div className="border-b border-border p-3">
        <div className="hidden items-center gap-1 overflow-x-auto pb-2 md:flex" role="tablist" aria-label={t('open_carts')}>
          {carts.map((cartState) => {
            const itemCount = cartState.items.reduce((sum, item) => sum + item.qty, 0);
            const selected = cartState.id === activeCartId;
            return (
              <button
                key={cartState.id}
                type="button"
                role="tab"
                aria-selected={selected}
                onClick={() => setActiveCartId(cartState.id)}
                className={'num inline-flex min-h-11 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ' + (selected ? 'bg-primary-soft text-primary' : 'bg-background text-muted hover:text-text')}
              >
                {cartState.customer?.name ?? t('cart_named', { number: cartState.number })}
                <span className="rounded bg-surface px-1.5 py-0.5 text-[10px]">{itemCount}</span>
              </button>
            );
          })}
          <button type="button" onClick={createCart} className="grid min-h-11 min-w-11 shrink-0 place-items-center rounded-md border border-dashed border-border text-muted hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" aria-label={t('new_cart')}>
            <Plus className="h-4 w-4" strokeWidth={1.7} />
          </button>
        </div>
        <div className="mb-2 flex items-center gap-2 md:hidden">
          <button type="button" onClick={() => setOpenCartsOpen(true)} className="min-h-11 min-w-0 flex-1 rounded-md bg-background px-3 py-2 text-start text-sm font-semibold text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
            <span className="block truncate">{selectedCustomer?.name ?? t('cart_named', { number: activeCart.number })}</span>
            <span className="num text-xs text-muted">{t('cart_count', { count: carts.length })} · {t('item_count', { count })}</span>
          </button>
          <button type="button" onClick={createCart} className="grid min-h-11 min-w-11 place-items-center rounded-md border border-border text-text hover:bg-primary-soft hover:text-primary" aria-label={t('new_cart')}>
            <Plus className="h-4 w-4" strokeWidth={1.7} />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className={'flex min-h-11 min-w-0 flex-1 items-center justify-between gap-2 rounded-md border bg-background px-3 text-sm font-semibold touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ' + (selectedCustomer ? 'border-primary text-primary' : 'border-border text-text')}
          >
            <span className="truncate">{customerName}</span>
            <User className="h-4 w-4 shrink-0 text-muted" strokeWidth={1.7} />
          </button>
          <button type="button" onClick={() => setPickerOpen(true)} className="grid min-h-11 min-w-11 place-items-center rounded-md border border-border text-text hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" aria-label={t('add_customer')}>
            <UserPlus className="h-4 w-4" strokeWidth={1.7} />
          </button>
          <button type="button" onClick={() => setClearCartOpen(true)} disabled={cart.length === 0} className="grid min-h-11 min-w-11 place-items-center rounded-md border border-border text-muted hover:bg-negative/10 hover:text-negative disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" aria-label={t('clear_cart')}>
            <Trash className="h-4 w-4" strokeWidth={1.7} />
          </button>
          <button type="button" onClick={() => requestCloseCart(activeCart.id)} className="grid min-h-11 min-w-11 place-items-center rounded-md border border-border text-muted hover:bg-background hover:text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" aria-label={t('close_cart')}>
            <X className="h-4 w-4" strokeWidth={1.7} />
          </button>
        </div>
      </div>

      <div ref={registerCartContainer} tabIndex={-1} className="min-h-0 flex-1 overflow-y-auto px-3 outline-none">
        {cart.length === 0 && <PosCartEmptyState message={t('empty_cart')} />}
        {cart.map((line) => {
          const units = line.productId ? products.find((product) => product.id === line.productId)?.pos_units ?? [] : [];
          const lineSelected = policy.allowKeyboardPowerMode && keyboardActive && activeZone === 'cart' && selectedLineKey === line.key;
          return (
            <PosCartLineFrame
              key={line.key}
              selected={lineSelected}
              scanned={lastScannedLineKey === line.key}
              onSelect={() => {
                setSelectedLineKey(line.key);
                focusZone('cart', { cartLineKey: line.key });
              }}
              register={(element) => registerCartLine(line.key, element)}
            >
              <div className="flex min-w-0 flex-1 flex-col gap-2">
                <div className="flex items-start gap-2">
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-semibold text-text">{line.description}</div>
                    {line.productId !== null && units.length > 1 ? (
                      <select aria-label={tprod('unit')} value={line.unit ?? ''} onChange={(event) => setUnit(line.key, event.target.value)} onClick={(event) => event.stopPropagation()} className="mt-1 min-h-11 max-w-28 rounded border border-border bg-background px-1.5 text-xs text-text outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                        {units.map((unit) => <option key={unit.name} value={unit.name}>{unit.name}</option>)}
                      </select>
                    ) : line.unit ? <div className="mt-1 text-xs text-muted">{line.unit}</div> : null}
                  </div>
                  <PosCartRemoveButton label={t('remove')} onRemove={() => remove(line.key)} />
                </div>
                {(posCfg.allow_unit_price_override || posCfg.allow_discount) && (
                  <div className="flex flex-wrap gap-2" onClick={(event) => event.stopPropagation()}>
                    {posCfg.allow_unit_price_override && (
                      <label className="flex items-center gap-1 text-xs text-muted">
                        {t('unit_price')}
                        <PosNumericEditor
                          allowDecimal
                          className="h-11 w-20 px-2 text-xs"
                          inputAriaLabel={t('unit_price')}
                          labels={numericEditorLabels}
                          onApply={(value) => normalizeUnitPrice(line.key, value)}
                          onBlur={() => normalizeUnitPrice(line.key)}
                          onChange={(value) => setUnitPrice(line.key, value)}
                          showKeypad={posCfg.show_onscreen_numeric_keypad}
                          title={t('numeric_keypad_edit_unit_price')}
                          value={line.price}
                        />
                      </label>
                    )}
                    {posCfg.allow_discount && (
                      <label className="flex items-center gap-1 text-xs text-muted">
                        {t('discount')}
                        <PosNumericEditor
                          allowDecimal
                          className="h-11 w-16 px-2 text-xs"
                          inputAriaLabel={t('discount')}
                          labels={numericEditorLabels}
                          onChange={(value) => setDiscount(line.key, value)}
                          showKeypad={posCfg.show_onscreen_numeric_keypad}
                          title={t('numeric_keypad_edit_discount')}
                          value={line.discount}
                        />
                      </label>
                    )}
                  </div>
                )}
                {priceErrors[line.key] && <p className="text-xs text-negative">{priceErrors[line.key]}</p>}
                <PosCartQtyControls
                  qty={line.qty}
                  decreaseLabel={t('return_decrease')}
                  increaseLabel={t('return_increase')}
                  quantityLabel={t('quantity')}
                  keypadTitle={t('numeric_keypad_edit_quantity')}
                  showKeypad={posCfg.show_onscreen_numeric_keypad}
                  labels={numericEditorLabels}
                  onDecrease={() => setQty(line.key, -1)}
                  onIncrease={() => setQty(line.key, 1)}
                  onQtyChange={(value) => setQtyFromInput(line.key, value)}
                />
                <div className="flex items-baseline justify-end">
                  <span className="num text-sm font-bold text-text">{formatRiyal(lineCalc(line).total / 100)}</span>
                </div>
              </div>
            </PosCartLineFrame>
          );
        })}
      </div>

      <div className="space-y-2 border-t border-border p-3">
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={holdSale} disabled={cart.length === 0 || !session || holdBusy || catalogLoading} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm font-semibold text-text touch-manipulation hover:border-primary disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
            <PauseCircle className="h-4 w-4" strokeWidth={1.7} />{t('hold')}
          </button>
          <button type="button" onClick={() => setNoteOpen(true)} className="inline-flex min-h-11 items-center justify-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm font-semibold text-text touch-manipulation hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
            <StickyNote className="h-4 w-4" strokeWidth={1.7} />
            {t('cart_note')}
            {activeCart.note.trim() !== '' && <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />}
          </button>
        </div>
      </div>

      <div className="space-y-1.5 border-t border-border bg-background p-3" data-testid="pos-cart-totals">
        <div className="flex justify-between text-sm"><span className="text-muted">{t('subtotal')}</span><span className="num font-semibold text-text">{formatRiyal(subMinor / 100)}</span></div>
        {discMinor > 0 && <div className="flex justify-between text-sm"><span className="text-muted">{t('discount')}</span><span className="num font-semibold text-positive">−{formatRiyal(discMinor / 100)}</span></div>}
        <div className="flex justify-between text-sm"><span className="text-muted">{t('tax')}</span><span className="num font-semibold text-text">{formatRiyal(taxMinor / 100)}</span></div>
        <div className="flex items-baseline justify-between border-t border-border pt-2"><span className="text-sm font-semibold text-text">{t('total')}</span><span className="num text-xl font-bold text-text">{formatRiyal(totalMinor / 100)}</span></div>
      </div>

      <div className={POS_CART_PAY_FOOTER_CLASS}>
        <button
          type="button"
          onClick={() => {
            if (pendingAttempt?.cartId === activeCart.id) {
              checkoutAttemptRef.current.adopt(pendingAttempt.attemptId);
            }
            setStep('payment');
          }}
          disabled={cart.length === 0 || catalogLoading || sessionInvalid || !online}
          data-testid="pos-cart-pay"
          className="flex min-h-14 w-full touch-manipulation items-center justify-between rounded-md bg-primary px-4 text-base font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:pointer-events-none disabled:cursor-not-allowed disabled:opacity-50"
        >
          {t('pay')}<span className="num">{formatRiyal(totalMinor / 100)}{policy.showShortcutHints ? <span className="hidden lg:inline"> · F9</span> : null}</span>
        </button>
      </div>
    </aside>
  );

  const catsPanel = (
    <aside className={POS_DESKTOP_CATEGORIES_CLASS}>
      <h4 className="mb-1 px-1 text-xs font-bold text-muted">{t('categories')}</h4>
      {CATS.map(({ key, label, image, icon: Icon }) => {
        const on = cat === key;
        return (
          <button
            key={key}
            type="button"
            aria-pressed={on}
            onClick={() => setCat(key)}
            className={'flex min-h-12 w-full touch-manipulation flex-col items-center gap-2 rounded-lg border p-2 text-center text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ' + (on ? 'border-primary bg-primary-soft text-primary' : 'border-transparent text-text hover:bg-background')}
          >
            <span className="h-12 w-12 overflow-hidden rounded-md bg-background">
              {key === 'all' ? (
                <span className="grid h-full w-full place-items-center bg-primary-soft text-primary"><Icon className="h-5 w-5" strokeWidth={1.7} /></span>
              ) : (
                <PosCategoryImage path={image} alt={label} />
              )}
            </span>
            <span className="line-clamp-2 leading-tight">{label}</span>
          </button>
        );
      })}
    </aside>
  );

  if (!sessionReady || !session) {
    return (
      <div className="grid h-full place-items-center bg-background text-sm text-muted">
        …
      </div>
    );
  }

  return (
    <div
      className="flex h-full flex-col overflow-hidden bg-background"
      data-testid="pos-sale-shell"
      data-interaction-mode={interactionMode}
      data-keyboard-power={policy.allowKeyboardPowerMode ? 'on' : 'off'}
      data-shortcut-hints={policy.showShortcutHints ? 'on' : 'off'}
      data-prefer-touch={policy.preferTouchTargets ? 'on' : 'off'}
      data-scanner-enabled={policy.scannerEnabled ? 'on' : 'off'}
      onPointerDown={onPointerDown}
      onKeyDown={onKeyboardActiveKeyDown}
    >
      <p className="sr-only" aria-live="polite">{scanFeedbackMessage}</p>

      <PosTopbar
        cashier={cashier}
        branch={branch}
        session={session}
        online={online}
        warehouses={warehouses}
        warehouseId={warehouseId}
        warehouseDisabled={Boolean(session?.warehouse_id) || step === 'payment' || paying || sessionInvalid}
        onWarehouseChange={setWarehouseId}
        heldCount={heldCount}
        onManageSession={() => (session ? (setCountedBal(''), setSessionError(null), setCloseOpen(true)) : router.push('/dashboard'))}
        onOpenHeld={() => setRetrieveOpen(true)}
        onOpenRecentInvoices={() => setRecentInvoicesOpen(true)}
        onOpenCashDrawer={() => void openCashDrawer()}
        cashDrawerDisabled={!session || sessionInvalid || !sessionDrawerConfigured || !posCfg.cash_drawer_enabled || posCfg.cash_drawer_driver === 'unavailable' || drawerBusy}
        cashDrawerBusy={drawerBusy}
        onReturn={() => setReturnOpen(true)}
        onReturnToSystem={requestReturnToSystem}
        onExchange={() => setExchangeOpen(true)}
        onLogout={requestLogout}
        exchangeDisabled={cart.length === 0 || step === 'payment' || paying || sessionInvalid}
      />

      {(sessionRevalidating || !online) && session && (
        <div
          role="status"
          data-testid="pos-recovery-banner"
          className="no-print flex shrink-0 flex-wrap items-center justify-between gap-2 border-b border-border bg-surface px-3 py-2 text-sm sm:px-4"
        >
          <p className={!online ? 'text-negative' : 'text-muted'}>
            {!online ? t('checkout_offline_blocked') : t('session_revalidating')}
          </p>
        </div>
      )}

      {sessionInvalid && !session && (
        <div
          role="alert"
          data-testid="pos-session-invalid-banner"
          className="no-print border-b border-border bg-surface px-3 py-2 text-sm text-negative sm:px-4"
        >
          {t('session_closed_remote')}
        </div>
      )}

      {step === 'payment' ? (
        <PosPayment
          totalMinor={totalMinor}
          items={summaryItems}
          customerName={customerName}
          paymentMethods={availablePaymentMethods}
          defaultPaymentMethodId={posCfg.default_payment_method_id}
          allowDeferredPayment={posCfg.allow_deferred_payment}
          paymentMethodsLoading={paymentMethodsLoading}
          paymentMethodsLoadError={paymentMethodsError}
          paying={paying}
          checkoutPhase={checkoutPhase}
          offline={!online}
          error={error}
          onBack={requestPaymentCancel}
          onConfirm={confirmPayment}
        />
      ) : (
        <>
          {/* ديسكتوب lg+: 3 أعمدة. تابلت md: سلة+منتجات. جوال: تبويب واحد */}
          <div className={POS_SALE_GRID_CLASS}>
            <div className={posCartPaneClass(mobileTab)}>{cartPanel}</div>
            <div className={posProductsPaneClass(mobileTab)}>
              {productsPanel}
              {/* شريط سلة عائم (جوال فقط — التابلت يعرض السلة بجانب المنتجات) */}
              {count > 0 && (
                <button
                  type="button"
                  onClick={() => setMobileTab('cart')}
                  className={POS_CART_FAB_CLASS}
                >
                  <span className="num grid h-6 w-6 place-items-center rounded-lg bg-white/25 text-[13px] font-bold">{count}</span>
                  <span className="flex-1 text-start text-[13px] font-semibold">{t('view_cart')}</span>
                  <span className="num text-base font-extrabold">{formatRiyal(totalMinor / 100)}</span>
                </button>
              )}
            </div>
            {catsPanel}
          </div>

          <PosShortcuts visible={policy.showShortcutHints} />

          {/* تنقّل سفلي (جوال فقط) */}
          <nav className={POS_MOBILE_NAV_CLASS}>
            <button type="button" onClick={() => setRecentInvoicesOpen(true)} className="flex min-h-11 flex-col items-center justify-center gap-1 text-[10.5px] font-semibold text-muted touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><MoreHorizontal className="h-5 w-5" strokeWidth={1.8} />{t('nav_more')}</button>
            <button type="button" onClick={() => setPickerOpen(true)} className="flex min-h-11 flex-col items-center justify-center gap-1 text-[10.5px] font-semibold text-muted touch-manipulation focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><Users className="h-5 w-5" strokeWidth={1.8} />{t('nav_customers')}</button>
            <button type="button" onClick={() => setMobileTab('products')} className={'flex min-h-11 flex-col items-center justify-center gap-1 text-[10.5px] font-semibold touch-manipulation ' + (mobileTab === 'products' ? 'text-primary' : 'text-muted')}>
              <LayoutGrid className="h-5 w-5" strokeWidth={1.8} />{t('nav_products')}
            </button>
            <button type="button" onClick={() => setMobileTab('cart')} className={'relative flex min-h-11 flex-col items-center justify-center gap-1 text-[10.5px] font-semibold touch-manipulation ' + (mobileTab === 'cart' ? 'text-primary' : 'text-muted')}>
              <ShoppingCart className="h-5 w-5" strokeWidth={1.8} />{t('cart')}
              {count > 0 && <span className="num absolute end-[calc(50%-18px)] top-2 grid h-4 min-w-4 place-items-center rounded-lg bg-negative px-1 text-[9px] font-bold text-white">{count}</span>}
            </button>
          </nav>
        </>
      )}

      <ReceiptDialog receipt={receipt} autoPrint={posCfg.print_receipt} paperSize={posCfg.receipt_paper_size} onClose={() => setReceipt(null)} />
      <PosReturnDialog
        open={returnOpen}
        sessionId={session?.id ?? null}
        onClose={() => setReturnOpen(false)}
        onReturned={(number) => { setReturnOpen(false); success(t('return_done', { number })); }}
      />
      <PosExchangeDialog
        open={exchangeOpen}
        sessionId={session?.id ?? null}
        replacementItems={cart}
        replacementTotalMinor={totalMinor}
        taxInclusive={taxInclusive}
        onClose={() => setExchangeOpen(false)}
        onExchanged={(number) => { setExchangeOpen(false); closeCart(activeCart.id); setStep('sale'); setMobileTab('products'); success(t('exchange_done', { number })); }}
      />

      <CustomerPickerDialog
        open={pickerOpen}
        onClose={() => { setPickerOpen(false); restoreFocusAfterUi(); }}
        onSelect={setSelectedCustomer}
      />

      <PosHeldSalesDialog
        open={retrieveOpen}
        sessionId={session?.id ?? null}
        onClose={() => setRetrieveOpen(false)}
        onResumed={retrieveSale}
        onChanged={refreshHeldCount}
      />

      <PosRecentInvoicesDialog open={recentInvoicesOpen} onClose={() => setRecentInvoicesOpen(false)} />

      <PosProductQuickView
        open={quickViewProductId !== null}
        onClose={() => setQuickViewProductId(null)}
        title={t('quick_view')}
        product={((): PosProductQuickViewProduct | null => {
          const p = products.find((item) => item.id === quickViewProductId);
          if (!p) return null;
          return {
            id: p.id,
            name: p.name,
            sku: p.sku,
            barcode: p.barcode,
            category: p.category,
            sale_price_label: formatRiyal(p.sale_price),
            pos_image: p.pos_image,
            track_inventory: p.track_inventory,
            quantity_on_hand: p.quantity_on_hand,
            units: p.pos_units.map((unit) => ({ name: unit.name, factor: unit.factor })),
          };
        })()}
        fields={{
          sku: t('sku'),
          barcode: t('barcode'),
          category: t('categories'),
          units: t('quick_view_units'),
          stock: t('quick_view_stock'),
          outOfStock: t('out_of_stock'),
          inStock: t('available'),
        }}
        openInErpHref={canOpenProductInErp && quickViewProductId ? `/products/${quickViewProductId}` : undefined}
        openInErpLabel={t('quick_view_open_in_erp')}
      />

      <PosDialog open={openCartsOpen} onClose={() => setOpenCartsOpen(false)} title={t('open_carts')}>
        <div className="space-y-2">
          {carts.map((cartState) => {
            const itemCount = cartState.items.reduce((sum, item) => sum + item.qty, 0);
            const selected = cartState.id === activeCartId;
            return (
              <div key={cartState.id} className={'flex items-center gap-2 rounded-lg border p-3 ' + (selected ? 'border-primary bg-primary-soft' : 'border-border bg-surface')}>
                <button type="button" onClick={() => { setActiveCartId(cartState.id); setOpenCartsOpen(false); setMobileTab('cart'); }} className="min-h-11 min-w-0 flex-1 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                  <div className="truncate text-sm font-semibold text-text">{cartState.customer?.name ?? t('cart_named', { number: cartState.number })}</div>
                  <div className="num mt-1 text-xs text-muted">{t('item_count', { count: itemCount })}</div>
                </button>
                <Button type="button" variant="ghost" size="icon" className="min-h-11 min-w-11" onClick={() => requestCloseCart(cartState.id)} aria-label={t('close_cart')}><X className="h-4 w-4" strokeWidth={1.7} /></Button>
              </div>
            );
          })}
          <Button type="button" variant="outline" className="min-h-11 w-full" onClick={() => { createCart(); setOpenCartsOpen(false); setMobileTab('cart'); }}><Plus className="h-4 w-4" strokeWidth={1.7} />{t('new_cart')}</Button>
        </div>
      </PosDialog>

      <PosAuditReasonDialog
        open={sensitiveAction !== null}
        title={sensitiveAction?.type === 'item_removed' ? t('remove') : sensitiveAction?.type === 'payment_cancelled' ? t('payment') : t('clear_cart')}
        busy={sensitiveBusy}
        onClose={() => setSensitiveAction(null)}
        onConfirm={confirmSensitiveAction}
      />

      <PosDialog open={cartToClose !== null} onClose={() => setCartToClose(null)} title={t('close_cart_confirm')}>
        <p className="text-sm leading-relaxed text-muted">{t('close_cart_description')}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" className="min-h-11" onClick={() => setCartToClose(null)}>{ts('cancel')}</Button>
          <Button type="button" variant="danger" className="min-h-11" onClick={confirmCloseCart}>{t('close_cart')}</Button>
        </div>
      </PosDialog>

      <PosDialog open={clearCartOpen} onClose={() => setClearCartOpen(false)} title={t('clear_cart_confirm')}>
        <p className="text-sm leading-relaxed text-muted">{t('clear_cart_description')}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" className="min-h-11" onClick={() => setClearCartOpen(false)}>{ts('cancel')}</Button>
          <Button type="button" variant="danger" className="min-h-11" onClick={confirmClearActiveCart}>{t('clear_cart')}</Button>
        </div>
      </PosDialog>

      <PosDialog open={noteOpen} onClose={() => setNoteOpen(false)} title={t('cart_note')}>
        <div className="space-y-4">
          <textarea
            value={activeCart.note}
            onChange={(event) => patchActive({ note: event.target.value })}
            maxLength={2000}
            rows={4}
            className="w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          />
          <div className="flex justify-end"><Button type="button" className="min-h-11" onClick={() => setNoteOpen(false)}>{ts('save')}</Button></div>
        </div>
      </PosDialog>

      <PosDialog open={unsavedExitAction !== null} onClose={() => setUnsavedExitAction(null)} title={t('unsaved_carts_exit_title')}>
        <p className="text-sm leading-relaxed text-muted">{t('unsaved_carts_exit_description')}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" className="min-h-11" onClick={() => setUnsavedExitAction(null)}>{ts('cancel')}</Button>
          <Button type="button" variant="danger" className="min-h-11" onClick={() => void confirmUnsavedExit()}>{t('unsaved_carts_exit_confirm')}</Button>
        </div>
      </PosDialog>

      {/* إغلاق الوردية: عدّ النقد → المتوقّع/الفرق يُحسبان في الخادم ثم نغادر. */}
      <PosDialog open={closeOpen} onClose={() => setCloseOpen(false)} title={ts('close_title')}>
        <form onSubmit={closeSession} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="cb">{ts('counted')}</Label>
            <Input id="cb" className="num text-end" inputMode="decimal" value={countedBal} onChange={(e) => setCountedBal(e.target.value)} required autoFocus />
          </div>
          {sessionError && <p className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{sessionError}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" className="min-h-11" onClick={() => setCloseOpen(false)}>{ts('cancel')}</Button>
            <Button type="submit" className="min-h-11" disabled={sessionBusy}>{ts('close')}</Button>
          </div>
        </form>
      </PosDialog>
    </div>
  );
}
