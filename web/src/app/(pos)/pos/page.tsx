'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Search, Barcode, Star, Package, Plus, Minus, Trash2,
  User, UserPlus, StickyNote, LayoutGrid, ShoppingCart,
  Users, MoreHorizontal, PauseCircle, Archive, Trash,
} from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api';
import { logout } from '@/lib/auth';
import { formatRiyal, riyalToMinor, extractInclusiveTax } from '@/lib/money';
import { getSystemTaxInclusive } from '@/lib/tax';
import { useBranches } from '@/lib/branch';
import type { Warehouse } from '@/lib/warehouse';
import { ReceiptDialog, type Receipt } from '@/components/pos/receipt-dialog';
import { PosTopbar } from '@/components/pos/pos-topbar';
import { PosRecentInvoicesDialog } from '@/components/pos/pos-recent-invoices-dialog';
import { PosProductImage } from '@/components/pos/pos-product-image';
import { PosCategoryImage } from '@/components/pos/pos-category-image';
import { cartHasUnsavedData, createPosActiveCart, usePosActiveCarts, type PosCartLine } from '@/components/pos/use-pos-active-carts';
import { PosShortcuts } from '@/components/pos/pos-shortcuts';
import { PosPayment, type PaymentSummaryItem, type PosPaymentMethod, type PosTender } from '@/components/pos/pos-payment';
import { PosExchangeDialog } from '@/components/pos/pos-exchange-dialog';
import { PosHeldSalesDialog, type PosHeldSale } from '@/components/pos/pos-held-sales-dialog';
import { PosReturnDialog } from '@/components/pos/pos-return-dialog';
import { PosNumericEditor } from '@/components/pos/pos-numeric-editor';
import { CustomerPickerDialog, type PosCustomer } from '@/components/pos/customer-picker';
import { buildInvoiceDocumentModel, type SourceInvoice, type SourceCompany } from '@/modules/documents/builder/from-invoice';
import type { LiveTemplateRevision } from '@/modules/print-templates/services/live-template-definition';
import { appendPosCartProduct, matchPosBarcode } from '@/lib/pos-barcode';
import { POS_FEEDBACK_DEFAULTS, posSound, type PosFeedbackSettings, type PosSoundEvent } from '@/lib/pos-sound';
import { runPosCheckout } from '@/lib/pos-checkout';
import { resolvePosDefaultCustomer } from '@/lib/pos-default-customer';
import { executeCashDrawerAction, type CashDrawerAction, type CashDrawerBridgeResult } from '@/lib/cash-drawer-bridge';

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
  held_sale_close_policy: 'discard_on_session_close' | 'keep_for_next_session';
  enabled_payment_method_ids: string[];
  payment_methods_mode: 'all_active' | 'only' | 'none';
  default_payment_method_id: string | null;
  allow_deferred_payment: boolean;
  show_product_images: boolean;
  cash_drawer_enabled: boolean;
  cash_drawer_driver: string;
  cash_drawer_auto_open_after_cash: boolean;
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
  held_sale_close_policy: 'discard_on_session_close',
  enabled_payment_method_ids: [],
  payment_methods_mode: 'all_active',
  default_payment_method_id: null,
  allow_deferred_payment: true,
  show_product_images: true,
  cash_drawer_enabled: false,
  cash_drawer_driver: 'unavailable',
  cash_drawer_auto_open_after_cash: false,
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
}
interface PosDevice { id: string; name: string; code: string | null; warehouse_id: string; is_active: boolean; warehouse?: { id: string; code: string; name: string } | null; cash_drawer?: { configured: boolean } }
interface WorkShift { id: string; name: string; is_active: boolean }
interface PosSession { id: string; number: string; status: string; pos_device_id?: string | null; warehouse_id?: string | null; shift_id?: string | null; pos_device?: { id: string; name: string; code: string | null } | null; warehouse?: { id: string; code: string; name: string } | null }
interface PosCheckoutResponse {
  data: {
    id: string;
    number: string;
    total: string;
    thermal_template_revision?: LiveTemplateRevision | null;
  };
  cash_drawer_action?: CashDrawerAction;
}

const FAV_KEY = 'nibras_pos_favs';

export default function PosPage() {
  const t = useTranslations('pos');
  const tc = useTranslations('common');
  const tprod = useTranslations('products');
  const router = useRouter();
  const { success, error: errorToast, toast } = useToast();
  const searchRef = useRef<HTMLInputElement>(null);

  const [products, setProducts] = useState<Product[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [cashier, setCashier] = useState('—');
  const [cashierScope, setCashierScope] = useState<{ userId: string; tenantId: string }>({ userId: '', tenantId: '' });
  const [companyName, setCompanyName] = useState('—');
  // الفرع المعروض: الفرع النشط (افتراضه الرئيسي)، وإلا اسم الشركة.
  const { active: activeBranch } = useBranches();
  const branch = activeBranch?.name ?? companyName;
  const [company, setCompany] = useState<SourceCompany | null>(null);
  const [search, setSearch] = useState('');
  const [cat, setCat] = useState('all');
  const [tab, setTab] = useState('all');
  const [favs, setFavs] = useState<Set<string>>(new Set());
  const [priceErrors, setPriceErrors] = useState<Record<string, string>>({});
  const [step, setStep] = useState<'sale' | 'payment'>('sale');
  const [mobileTab, setMobileTab] = useState<'products' | 'cart'>('products');
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const paymentRequestRef = useRef(false);
  const [posCfg, setPosCfg] = useState<PosConfig>(POS_DEFAULTS);
  const [paymentMethods, setPaymentMethods] = useState<PosPaymentMethod[]>([]);
  const [paymentMethodsLoading, setPaymentMethodsLoading] = useState(true);
  const [paymentMethodsError, setPaymentMethodsError] = useState<string | null>(null);
  // وضع الضريبة من إعدادات النظام (متضمَّن/غير متضمَّن) — يوحّد سلوك كل المعاملات.
  const [systemTaxInclusive, setSystemTaxInclusive] = useState(false);
  // الوردية (الجلسة النقدية) — تُربط بالبيع: تُفتح قبل البيع وتُغلق بعدّ النقد.
  const [session, setSession] = useState<PosSession | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [devices, setDevices] = useState<PosDevice[]>([]);
  const [shifts, setShifts] = useState<WorkShift[]>([]);
  const [deviceId, setDeviceId] = useState('');
  const [shiftId, setShiftId] = useState('');
  const [openBal, setOpenBal] = useState('');
  const [closeOpen, setCloseOpen] = useState(false);
  const [returnOpen, setReturnOpen] = useState(false);
  const [exchangeOpen, setExchangeOpen] = useState(false);
  const [countedBal, setCountedBal] = useState('');
  const [sessionBusy, setSessionBusy] = useState(false);
  const [drawerBusy, setDrawerBusy] = useState(false);
  const [sessionError, setSessionError] = useState<string | null>(null);
  const ts = useTranslations('posSessions');

  const activeCartStorageKey = session && cashierScope.userId && cashierScope.tenantId
    ? `nibras_pos_active_carts:${cashierScope.tenantId}:${activeBranch?.id ?? 'main'}:${session.pos_device_id ?? 'no-device'}:${session.warehouse_id ?? 'no-warehouse'}:${session.shift_id ?? 'no-shift'}:${session.id}:${cashierScope.userId}`
    : null;
  const {
    carts, activeCart, activeCartId, hydrated, setActiveCartId, patchActive, updateActiveItems, updateCarts,
    openCart, createCart, closeCart,
  } = usePosActiveCarts({ storageKey: activeCartStorageKey, defaultTaxInclusive: systemTaxInclusive });
  const cart = activeCart.items;
  const selectedCustomer = activeCart.customer;
  const taxInclusive = activeCart.taxInclusive;
  const setCart = useCallback((updater: PosCartLine[] | ((current: PosCartLine[]) => PosCartLine[])) => {
    updateActiveItems((current) => typeof updater === 'function' ? updater(current) : updater);
  }, [updateActiveItems]);
  const setSelectedCustomer = useCallback((customer: PosCustomer | null) => patchActive({ customer }), [patchActive]);
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
  const [unsavedExitAction, setUnsavedExitAction] = useState<'close_session' | 'logout' | null>(null);
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
    api<{ user?: { id?: string; tenant_id?: string; name?: string }; company?: { name?: string; vat_number?: string | null; cr_number?: string | null } }>('/me')
      .then((r) => {
        setCashier(r.user?.name ?? t('cashier'));
        setCashierScope({ userId: r.user?.id ?? '', tenantId: r.user?.tenant_id ?? '' });
        setCompanyName(r.company?.name ?? t('main_branch'));
        if (r.company) setCompany({ name: r.company.name ?? '—', vat_number: r.company.vat_number ?? null, cr_number: r.company.cr_number ?? null });
      })
      .catch(() => {});
    api<{ data: Partial<PosConfig> }>('/sales-config/pos')
      .then((r) => setPosCfg({ ...POS_DEFAULTS, ...r.data }))
      .catch(() => {});
    api<{ data: PosPaymentMethod[] }>('/payment-methods')
      .then((r) => setPaymentMethods(r.data.filter((method) => method.is_active)))
      .catch((err) => setPaymentMethodsError(err instanceof ApiError ? err.message : tc('loadFailed')))
      .finally(() => setPaymentMethodsLoading(false));
    getSystemTaxInclusive().then(setSystemTaxInclusive).catch(() => {});
    api<{ data: PosDevice[] }>('/pos-devices').then((r) => setDevices(r.data.filter((device) => device.is_active))).catch(() => {});
    api<{ data: WorkShift[] }>('/shifts').then((r) => setShifts(r.data.filter((shift) => shift.is_active))).catch(() => {});
    // الوردية المفتوحة الحالية (إن وُجدت) — وإلا تُعرض بوابة فتح وردية. يثبّت
    // مخزن الجهاز على الشاشة حتى لا تعرض اختياراً سيرفضه الخادم لاحقاً.
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
    setCart((current) => appendPosCartProduct(current, p, unit, quantity));
    return lineKey;
  }

  const setUnit = (key: string, unitName: string) => {
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
  };
  const setQty = (k: string, d: number) => setCart((c) => c.map((l) => (l.key === k ? { ...l, qty: Math.max(1, l.qty + d) } : l)));
  const setQtyFromInput = (k: string, value: string) => {
    if (!/^\d+$/.test(value)) return;
    const quantity = Number(value);
    if (!Number.isSafeInteger(quantity) || quantity < 1) return;
    setCart((current) => current.map((line) => (line.key === k ? { ...line, qty: quantity } : line)));
  };
  const setDiscount = (k: string, v: string) => {
    if (!posCfg.allow_discount) return;
    setCart((c) => c.map((l) => (l.key === k ? { ...l, discount: v } : l)));
  };
  const setUnitPrice = (k: string, v: string) => {
    if (!posCfg.allow_unit_price_override) return;
    setPriceErrors((current) => {
      const { [k]: _cleared, ...rest } = current;
      return rest;
    });
    setCart((c) => c.map((l) => (l.key === k ? { ...l, price: v } : l)));
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
  const remove = (k: string) => setCart((c) => c.filter((l) => l.key !== k));

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
      await api('/pos/held-sales', {
        method: 'POST',
        body: {
          pos_session_id: session.id,
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
    } catch (err) {
      errorToast(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setHoldBusy(false);
    }
  }

  function retrieveSale(held: PosHeldSale) {
    const nextNumber = Math.max(0, ...carts.map((cartState) => cartState.number)) + 1;
    const restored = createPosActiveCart(nextNumber, held.tax_inclusive);
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
  // مرجع حيّ لأحدث scanCode (يقرأ أحدث products) — يُستدعى من مستمع لوحة المفاتيح.
  const scanRef = useRef(scanCode);
  scanRef.current = scanCode;

  // ماسح الباركود (keyboard-wedge): يكتب الكود سريعاً ثم Enter. نلتقط التسلسل
  // السريع خارج حقول الإدخال، فالمسح يعمل دون تركيز حقل معيّن.
  useEffect(() => {
    let buf = '';
    let last = 0;
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement as HTMLElement | null;
      const editable = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      const now = Date.now();
      if (e.key === 'Enter') {
        if (!editable && buf.length >= 3) { e.preventDefault(); scanRef.current(buf); }
        buf = '';
        return;
      }
      if (editable) return; // لا نلتقط أثناء الكتابة اليدوية في الحقول
      if (e.key.length === 1) {
        if (now - last > 80) buf = ''; // فجوة طويلة = تسلسل بشري لا ماسح
        buf += e.key;
        last = now;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  // اختصارات لوحة المفاتيح الفعلية (مفاتيح وظيفية لا تتعارض مع ماسح الباركود).
  const cartRef = useRef(cart);
  cartRef.current = cart;
  const stepRef = useRef(step);
  stepRef.current = step;
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const el = document.activeElement as HTMLElement | null;
      const editable = !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.isContentEditable);
      if (e.key === 'F2') { e.preventDefault(); setPickerOpen(true); }
      else if (e.key === 'F4') { e.preventDefault(); searchRef.current?.focus(); }
      else if (e.key === 'F8' && !editable) { e.preventDefault(); setCart((c) => c.slice(0, -1)); }
      else if (e.key === 'F9') { e.preventDefault(); if (cartRef.current.length > 0 && stepRef.current === 'sale') setStep('payment'); }
      else if (e.key === 'Escape' && stepRef.current === 'payment') { e.preventDefault(); setStep('sale'); }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

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

  async function openSession(e: React.FormEvent) {
    e.preventDefault();
    setSessionBusy(true);
    setSessionError(null);
    try {
      const r = await api<{ data: PosSession }>('/pos-sessions/open', {
        method: 'POST',
        body: { opening_balance: riyalToMinor(openBal), pos_device_id: deviceId, shift_id: shiftId || null },
      });
      setSession(r.data);
      if (r.data.warehouse_id) setWarehouseId(r.data.warehouse_id);
      setOpenBal('');
    } catch (err) {
      setSessionError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setSessionBusy(false);
    }
  }

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
    if (carts.some(cartHasUnsavedData)) {
      setUnsavedExitAction('close_session');
      return;
    }
    void finishCloseSession();
  }

  function requestLogout() {
    if (carts.some(cartHasUnsavedData)) {
      setUnsavedExitAction('logout');
      return;
    }
    void finishLogout();
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
  }

  const confirmPayment = useCallback(
    async (tenders: PosTender[]) => {
      if (catalogLoading) {
        setError(t('price_list_loading'));
        playPosFeedback('warning');
        return;
      }
      if (cart.length === 0) return;
      if (!session) {
        setError(t('open_to_start'));
        playPosFeedback('warning');
        return;
      }
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
      setError(null);
      try {
        const result = await runPosCheckout({
          submitCheckout: async () => {
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
              body: { partner_id: customer.id, pos_session_id: session.id, warehouse_id: warehouseId || null, tax_inclusive: taxInclusive, notes: activeCart.note.trim() || null, items, tenders },
            });
          },
          // لحظة النجاح المالي هي استجابة checkout؛ نغلق السلة ونغادر شاشة الدفع
          // قبل انتظار QR، فلا تعود العملية قابلة لإرسال الدفع نفسه مرة ثانية.
          onCheckoutSuccess: (checkout) => {
            playPosFeedback('payment_success');
            success(t('sale_done'));
            closeCart(activeCart.id);
            setStep('sale');
            setMobileTab('products');
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
          fetchQr: (created) => api<{ qr: string | null }>(`/invoices/${created.data.id}/zatca`),
          onPaymentError: (error) => {
            setError(error instanceof ApiError ? error.message : tc('saveFailed'));
            playPosFeedback('payment_error');
          },
          onQrUnavailable: () => {
            toast({ title: t('sale_done'), description: t('zatca_qr_unavailable'), variant: 'warning' });
          },
        });

        if (result.status !== 'success' || !result.checkout) return;

        // بناء الإيصال من لقطة السلة السابقة بعد cleanup. فشل نموذج الإيصال نفسه
        // لا يعيد شاشة الدفع ولا يحول بيعاً مؤكداً إلى فشل.
        try {
          const created = result.checkout.data;
          const toRiyal = (m: number) => (m / 100).toFixed(2);
          const totals = cart.reduce(
            (a, l) => { const c = lineCalc(l); return { sub: a.sub + c.net, tax: a.tax + c.tax, tot: a.tot + c.total }; },
            { sub: 0, tax: 0, tot: 0 },
          );
          // نوع الدفع للعرض: مسدّد فوراً بأي وسيلة مهيأة، وإلا آجل.
          const paidNow = tenders.reduce((sum, tender) => sum + tender.amount, 0);
          const receiptInvoice: SourceInvoice = {
            number: created.number,
            invoice_date: new Date().toISOString().slice(0, 10),
            payment_type: paidNow > 0 ? 'cash' : 'credit',
            subtotal: toRiyal(totals.sub),
            tax_amount: toRiyal(totals.tax),
            total: toRiyal(totals.tot),
            notes: null,
            lines: cart.map((l) => { const c = lineCalc(l); return {
              id: l.key, description: l.unit ? `${l.description} (${l.unit})` : l.description, quantity: l.qty,
              unit_price: effectiveLinePrice(l), tax_rate: l.tax, line_tax: toRiyal(c.tax), line_total: toRiyal(c.total),
            }; }),
          };
          const model = buildInvoiceDocumentModel({
            invoice: receiptInvoice,
            company,
            customer: { name: customer.name, vat_number: null, city: null },
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
      } finally {
        paymentRequestRef.current = false;
        setPaying(false);
      }
    },
    [activeCart, cart, catalogLoading, closeCart, success, t, tc, toast, selectedCustomer, posCfg.receipt_footer, posCfg.allow_discount, posCfg.allow_unit_price_override, taxInclusive, company, warehouseId, session, products, playPosFeedback],
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
    <section className="flex min-h-0 flex-col gap-3 overflow-y-auto p-3 sm:p-4 lg:p-5">
      <div className="flex gap-2">
        <button
          type="button"
          onClick={() => searchRef.current?.focus()}
          className="grid h-11 w-11 shrink-0 place-items-center rounded-md border border-border bg-surface text-text hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          aria-label={t('barcode_search')}
        >
          <Barcode className="h-4 w-4" strokeWidth={1.7} />
        </button>
        <div className="flex h-11 flex-1 items-center gap-2 rounded-md border border-border bg-surface px-3 focus-within:border-primary focus-within:ring-2 focus-within:ring-primary/20">
          <Search className="h-4 w-4 shrink-0 text-muted" strokeWidth={1.7} />
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && search.trim()) {
                e.preventDefault();
                if (scanCode(search.trim())) setSearch('');
              }
            }}
            placeholder={t('search_products')}
            className="min-w-0 flex-1 bg-transparent text-sm text-text outline-none placeholder:text-muted"
          />
          <kbd className="num hidden rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted sm:block">F4</kbd>
        </div>
      </div>

      {/* تصنيفات POS على الجوال/التابلت: صور سريعة مع تمرير أفقي، ونفس الفلتر التشغيلي. */}
      <div className="-mx-3 flex gap-2 overflow-x-auto px-3 pb-1 sm:-mx-4 sm:px-4 lg:hidden" aria-label={t('categories')}>
        {CATS.map(({ key, label, image, icon: Icon }) => {
          const on = cat === key;
          return (
            <button
              key={key}
              type="button"
              aria-pressed={on}
              onClick={() => setCat(key)}
              className={'flex w-[72px] shrink-0 flex-col items-center gap-1.5 rounded-lg border p-1.5 text-center focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ' + (on ? 'border-primary bg-primary-soft text-primary' : 'border-border bg-surface text-text')}
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
              className={'inline-flex h-9 items-center gap-1.5 rounded-md px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ' + (on ? 'bg-primary-soft text-primary' : 'text-muted hover:bg-surface hover:text-text')}
            >
              {Icon && <Icon className="h-3.5 w-3.5" strokeWidth={1.7} />}
              {qt.label}
            </button>
          );
        })}
      </div>

      <div className={'grid gap-3 ' + (posCfg.show_product_images ? 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5' : 'grid-cols-2 sm:grid-cols-3 lg:grid-cols-5 xl:grid-cols-6')}>
        {filtered.map((p) => {
          const tracked = p.track_inventory;
          const fav = favs.has(p.id);
          return (
            <div key={p.id} className="relative min-w-0">
              <button
                type="button"
                onClick={() => addProduct(p)}
                className={'flex w-full flex-col rounded-lg border border-border bg-surface p-2.5 text-start hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ' + (posCfg.show_product_images ? '' : 'min-h-28 justify-between')}
              >
                {posCfg.show_product_images && (
                  <div className={'mb-2.5 overflow-hidden rounded-md bg-background ' + (p.pos_image?.download_url ? 'aspect-[4/3]' : 'h-10')}>
                    <PosProductImage path={p.pos_image?.download_url} alt={p.name} />
                  </div>
                )}
                <span className="line-clamp-2 min-h-10 text-sm font-semibold leading-snug text-text">{p.name}</span>
                {p.sku && <span className="num mt-1 truncate text-[11px] text-muted">{p.sku}</span>}
                <div className="mt-2 flex items-end justify-between gap-2">
                  <span className="num text-sm font-bold text-primary">{formatRiyal(p.sale_price)}</span>
                  {tracked && <span className="num text-[11px] text-muted">{t('available')}: {p.quantity_on_hand}</span>}
                </div>
                <span className="mt-0.5 text-[10px] text-muted">{taxInclusive ? tprod('tax_incl_tag') : tprod('tax_excl_tag')}</span>
              </button>
              <button
                type="button"
                onClick={() => toggleFav(p.id)}
                className={'absolute end-2 top-2 grid h-8 w-8 place-items-center rounded-md bg-surface/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ' + (fav ? 'text-warning' : 'text-muted hover:text-primary')}
                aria-label={t('tab_favorites')}
              >
                <Star className="h-4 w-4" strokeWidth={1.7} fill={fav ? 'currentColor' : 'none'} />
              </button>
            </div>
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
      setCartToClose(cartId);
      return;
    }
    closeCart(cartId);
  }

  function confirmCloseCart() {
    if (cartToClose) closeCart(cartToClose);
    setCartToClose(null);
  }

  function confirmClearActiveCart() {
    setCart([]);
    patchActive({ customer: null, note: '', taxInclusive: systemTaxInclusive });
    setPriceErrors({});
    setClearCartOpen(false);
  }

  const cartPanel = (
    <aside className="flex min-h-0 flex-col overflow-hidden border-border bg-surface lg:border-e">
      <div className="border-b border-border p-3">
        <div className="hidden items-center gap-1 overflow-x-auto pb-2 lg:flex" role="tablist" aria-label={t('open_carts')}>
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
                className={'num inline-flex h-9 shrink-0 items-center gap-1.5 rounded-md px-2.5 text-xs font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ' + (selected ? 'bg-primary-soft text-primary' : 'bg-background text-muted hover:text-text')}
              >
                {cartState.customer?.name ?? t('cart_named', { number: cartState.number })}
                <span className="rounded bg-surface px-1.5 py-0.5 text-[10px]">{itemCount}</span>
              </button>
            );
          })}
          <button type="button" onClick={createCart} className="grid h-9 w-9 shrink-0 place-items-center rounded-md border border-dashed border-border text-muted hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" aria-label={t('new_cart')}>
            <Plus className="h-4 w-4" strokeWidth={1.7} />
          </button>
        </div>
        <div className="mb-2 flex items-center gap-2 lg:hidden">
          <button type="button" onClick={() => setOpenCartsOpen(true)} className="min-w-0 flex-1 rounded-md bg-background px-3 py-2 text-start text-sm font-semibold text-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
            <span className="block truncate">{selectedCustomer?.name ?? t('cart_named', { number: activeCart.number })}</span>
            <span className="num text-xs text-muted">{t('cart_count', { count: carts.length })} · {t('item_count', { count })}</span>
          </button>
          <button type="button" onClick={createCart} className="grid h-10 w-10 place-items-center rounded-md border border-border text-text hover:bg-primary-soft hover:text-primary" aria-label={t('new_cart')}>
            <Plus className="h-4 w-4" strokeWidth={1.7} />
          </button>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className={'flex h-10 min-w-0 flex-1 items-center justify-between gap-2 rounded-md border bg-background px-3 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ' + (selectedCustomer ? 'border-primary text-primary' : 'border-border text-text')}
          >
            <span className="truncate">{customerName}</span>
            <User className="h-4 w-4 shrink-0 text-muted" strokeWidth={1.7} />
          </button>
          <button type="button" onClick={() => setPickerOpen(true)} className="grid h-10 w-10 place-items-center rounded-md border border-border text-text hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" aria-label={t('add_customer')}>
            <UserPlus className="h-4 w-4" strokeWidth={1.7} />
          </button>
          <button type="button" onClick={() => setClearCartOpen(true)} disabled={cart.length === 0} className="grid h-10 w-10 place-items-center rounded-md border border-border text-muted hover:bg-negative/10 hover:text-negative disabled:opacity-40 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" aria-label={t('clear_cart')}>
            <Trash className="h-4 w-4" strokeWidth={1.7} />
          </button>
          <button type="button" onClick={() => requestCloseCart(activeCart.id)} className="grid h-10 w-10 place-items-center rounded-md border border-border text-muted hover:bg-negative/10 hover:text-negative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" aria-label={t('close_cart')}>
            <Trash2 className="h-4 w-4" strokeWidth={1.7} />
          </button>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3">
        {cart.length === 0 && <p className="py-10 text-center text-sm text-muted">{t('empty_cart')}</p>}
        {cart.map((line) => {
          const units = line.productId ? products.find((product) => product.id === line.productId)?.pos_units ?? [] : [];
          return (
            <div key={line.key} className={'flex gap-2 border-b py-3 transition-colors motion-reduce:transition-none last:border-0 ' + (lastScannedLineKey === line.key ? 'border-primary bg-primary-soft' : 'border-border')}>
              <div className="min-w-0 flex-1">
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate text-sm font-semibold text-text">{line.description}</div>
                    {line.productId !== null && units.length > 1 ? (
                      <select aria-label={tprod('unit')} value={line.unit ?? ''} onChange={(event) => setUnit(line.key, event.target.value)} className="mt-1 h-7 max-w-28 rounded border border-border bg-background px-1.5 text-xs text-text outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                        {units.map((unit) => <option key={unit.name} value={unit.name}>{unit.name}</option>)}
                      </select>
                    ) : line.unit ? <div className="mt-1 text-xs text-muted">{line.unit}</div> : null}
                  </div>
                  <button type="button" onClick={() => remove(line.key)} className="grid h-10 w-10 shrink-0 place-items-center rounded-md text-muted hover:bg-negative/10 hover:text-negative focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" aria-label={t('remove')}>
                    <Trash2 className="h-4 w-4" strokeWidth={1.7} />
                  </button>
                </div>
                {(posCfg.allow_unit_price_override || posCfg.allow_discount) && (
                  <div className="mt-2 flex flex-wrap gap-2">
                    {posCfg.allow_unit_price_override && (
                      <label className="flex items-center gap-1 text-xs text-muted">
                        {t('unit_price')}
                        <PosNumericEditor
                          allowDecimal
                          className="h-8 w-20 px-2 text-xs"
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
                          className="h-8 w-16 px-2 text-xs"
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
                {priceErrors[line.key] && <p className="mt-1 text-xs text-negative">{priceErrors[line.key]}</p>}
                <div className="mt-2 flex items-center justify-between gap-2">
                  <div className="flex h-10 items-center rounded-md border border-border bg-background">
                    <button type="button" onClick={() => setQty(line.key, -1)} className="grid h-10 w-10 place-items-center text-text hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" aria-label={t('return_decrease')}><Minus className="h-4 w-4" strokeWidth={1.7} /></button>
                    <PosNumericEditor
                      allowDecimal={false}
                      className="h-10 w-9 text-sm font-semibold"
                      inputAriaLabel={t('quantity')}
                      labels={numericEditorLabels}
                      onChange={(value) => setQtyFromInput(line.key, value)}
                      showKeypad={posCfg.show_onscreen_numeric_keypad}
                      title={t('numeric_keypad_edit_quantity')}
                      value={String(line.qty)}
                    />
                    <button type="button" onClick={() => setQty(line.key, 1)} className="grid h-10 w-10 place-items-center text-text hover:bg-primary-soft hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" aria-label={t('return_increase')}><Plus className="h-4 w-4" strokeWidth={1.7} /></button>
                  </div>
                  <span className="num text-sm font-bold text-text">{formatRiyal(lineCalc(line).total / 100)}</span>
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="space-y-2 border-t border-border p-3">
        <div className="grid grid-cols-2 gap-2">
          <button type="button" onClick={holdSale} disabled={cart.length === 0 || !session || holdBusy || catalogLoading} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm font-semibold text-text hover:border-primary disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
            <PauseCircle className="h-4 w-4" strokeWidth={1.7} />{t('hold')}
          </button>
          <button type="button" onClick={() => setNoteOpen(true)} className="inline-flex h-10 items-center justify-center gap-1.5 rounded-md border border-border bg-surface px-3 text-sm font-semibold text-text hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
            <StickyNote className="h-4 w-4" strokeWidth={1.7} />{t('cart_note')}
          </button>
        </div>
      </div>

      <div className="space-y-1.5 border-t border-border bg-background p-3">
        <div className="flex justify-between text-sm"><span className="text-muted">{t('subtotal')}</span><span className="num font-semibold text-text">{formatRiyal(subMinor / 100)}</span></div>
        {discMinor > 0 && <div className="flex justify-between text-sm"><span className="text-muted">{t('discount')}</span><span className="num font-semibold text-positive">−{formatRiyal(discMinor / 100)}</span></div>}
        <div className="flex justify-between text-sm"><span className="text-muted">{t('tax')}</span><span className="num font-semibold text-text">{formatRiyal(taxMinor / 100)}</span></div>
        <div className="flex items-baseline justify-between border-t border-border pt-2"><span className="font-semibold text-text">{t('total')}</span><span className="num text-xl font-bold text-text">{formatRiyal(totalMinor / 100)}</span></div>
      </div>

      <div className="p-3 pt-0">
        <button onClick={() => setStep('payment')} disabled={cart.length === 0 || catalogLoading} className="flex h-12 w-full items-center justify-between rounded-md bg-primary px-4 text-base font-bold text-white focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50">
          {t('pay')}<span className="num">{formatRiyal(totalMinor / 100)} · F9</span>
        </button>
      </div>
    </aside>
  );

  const catsPanel = (
    <aside className="hidden flex-col gap-2 overflow-y-auto border-s border-border bg-surface p-3 lg:flex">
      <h4 className="mb-1 px-1 text-xs font-bold text-muted">{t('categories')}</h4>
      {CATS.map(({ key, label, image, icon: Icon }) => {
        const on = cat === key;
        return (
          <button
            key={key}
            type="button"
            aria-pressed={on}
            onClick={() => setCat(key)}
            className={'flex w-full flex-col items-center gap-2 rounded-lg border p-2 text-center text-[11px] font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ' + (on ? 'border-primary bg-primary-soft text-primary' : 'border-transparent text-text hover:bg-background')}
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

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <p className="sr-only" aria-live="polite">{scanFeedbackMessage}</p>

      <PosTopbar
        cashier={cashier}
        branch={branch}
        session={session}
        warehouses={warehouses}
        warehouseId={warehouseId}
        warehouseDisabled={Boolean(session?.warehouse_id) || step === 'payment' || paying}
        onWarehouseChange={setWarehouseId}
        heldCount={heldCount}
        onManageSession={() => (session ? (setCountedBal(''), setSessionError(null), setCloseOpen(true)) : router.push('/dashboard'))}
        onOpenHeld={() => setRetrieveOpen(true)}
        onOpenRecentInvoices={() => setRecentInvoicesOpen(true)}
        onOpenCashDrawer={() => void openCashDrawer()}
        cashDrawerDisabled={!session || !sessionDrawerConfigured || !posCfg.cash_drawer_enabled || posCfg.cash_drawer_driver === 'unavailable' || drawerBusy}
        cashDrawerBusy={drawerBusy}
        onReturn={() => setReturnOpen(true)}
        onExchange={() => setExchangeOpen(true)}
        onLogout={requestLogout}
        exchangeDisabled={cart.length === 0 || step === 'payment' || paying}
      />

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
          error={error}
          onBack={() => setStep('sale')}
          onConfirm={confirmPayment}
        />
      ) : (
        <>
          {/* ديسكتوب: 3 أعمدة (سلة · منتجات · أقسام) — جوال: تبويب واحد */}
          <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[minmax(360px,420px)_minmax(0,1fr)_148px]">
            <div className={mobileTab === 'cart' ? 'flex min-h-0' : 'hidden lg:flex lg:min-h-0'}>{cartPanel}</div>
            <div className={mobileTab === 'products' ? 'relative flex min-h-0 flex-col' : 'hidden lg:flex lg:min-h-0 lg:flex-col'}>
              {productsPanel}
              {/* شريط سلة عائم (جوال فقط) */}
              {count > 0 && (
                <button
                  onClick={() => setMobileTab('cart')}
                  className="absolute inset-x-3 bottom-3 flex h-12 items-center gap-3 rounded-md bg-primary px-4 text-white lg:hidden"
                >
                  <span className="num grid h-6 w-6 place-items-center rounded-lg bg-white/25 text-[13px] font-bold">{count}</span>
                  <span className="flex-1 text-start text-[13px] font-semibold">{t('view_cart')}</span>
                  <span className="num text-base font-extrabold">{formatRiyal(totalMinor / 100)}</span>
                </button>
              )}
            </div>
            {catsPanel}
          </div>

          <PosShortcuts />

          {/* تنقّل سفلي (جوال) */}
          <nav className="grid h-16 shrink-0 grid-cols-4 border-t border-border bg-surface lg:hidden">
            <button type="button" onClick={() => setRecentInvoicesOpen(true)} className="flex flex-col items-center justify-center gap-1 text-[10.5px] font-semibold text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><MoreHorizontal className="h-5 w-5" strokeWidth={1.8} />{t('nav_more')}</button>
            <button type="button" onClick={() => setPickerOpen(true)} className="flex flex-col items-center justify-center gap-1 text-[10.5px] font-semibold text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><Users className="h-5 w-5" strokeWidth={1.8} />{t('nav_customers')}</button>
            <button onClick={() => setMobileTab('products')} className={'flex flex-col items-center justify-center gap-1 text-[10.5px] font-semibold ' + (mobileTab === 'products' ? 'text-primary' : 'text-muted')}>
              <LayoutGrid className="h-5 w-5" strokeWidth={1.8} />{t('nav_products')}
            </button>
            <button onClick={() => setMobileTab('cart')} className={'relative flex flex-col items-center justify-center gap-1 text-[10.5px] font-semibold ' + (mobileTab === 'cart' ? 'text-primary' : 'text-muted')}>
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
        onClose={() => setPickerOpen(false)}
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

      <Dialog open={openCartsOpen} onClose={() => setOpenCartsOpen(false)} title={t('open_carts')}>
        <div className="space-y-2">
          {carts.map((cartState) => {
            const itemCount = cartState.items.reduce((sum, item) => sum + item.qty, 0);
            const selected = cartState.id === activeCartId;
            return (
              <div key={cartState.id} className={'flex items-center gap-2 rounded-lg border p-3 ' + (selected ? 'border-primary bg-primary-soft' : 'border-border bg-surface')}>
                <button type="button" onClick={() => { setActiveCartId(cartState.id); setOpenCartsOpen(false); setMobileTab('cart'); }} className="min-w-0 flex-1 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                  <div className="truncate text-sm font-semibold text-text">{cartState.customer?.name ?? t('cart_named', { number: cartState.number })}</div>
                  <div className="num mt-1 text-xs text-muted">{t('item_count', { count: itemCount })}</div>
                </button>
                <Button type="button" variant="ghost" size="icon" onClick={() => requestCloseCart(cartState.id)} aria-label={t('close_cart')}><Trash2 className="h-4 w-4" strokeWidth={1.7} /></Button>
              </div>
            );
          })}
          <Button type="button" variant="outline" className="w-full" onClick={() => { createCart(); setOpenCartsOpen(false); setMobileTab('cart'); }}><Plus className="h-4 w-4" strokeWidth={1.7} />{t('new_cart')}</Button>
        </div>
      </Dialog>

      <Dialog open={cartToClose !== null} onClose={() => setCartToClose(null)} title={t('close_cart_confirm')}>
        <p className="text-sm leading-relaxed text-muted">{t('close_cart_description')}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => setCartToClose(null)}>{ts('cancel')}</Button>
          <Button type="button" variant="danger" onClick={confirmCloseCart}>{t('close_cart')}</Button>
        </div>
      </Dialog>

      <Dialog open={clearCartOpen} onClose={() => setClearCartOpen(false)} title={t('clear_cart_confirm')}>
        <p className="text-sm leading-relaxed text-muted">{t('clear_cart_description')}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => setClearCartOpen(false)}>{ts('cancel')}</Button>
          <Button type="button" variant="danger" onClick={confirmClearActiveCart}>{t('clear_cart')}</Button>
        </div>
      </Dialog>

      <Dialog open={noteOpen} onClose={() => setNoteOpen(false)} title={t('cart_note')}>
        <div className="space-y-4">
          <textarea
            value={activeCart.note}
            onChange={(event) => patchActive({ note: event.target.value })}
            maxLength={2000}
            rows={4}
            className="w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          />
          <div className="flex justify-end"><Button type="button" onClick={() => setNoteOpen(false)}>{ts('save')}</Button></div>
        </div>
      </Dialog>

      {/* بوابة الوردية: لا بيع قبل فتح وردية — الإغلاق = مغادرة نقطة البيع. */}
      <Dialog open={sessionReady && !session} onClose={() => router.push('/dashboard')} title={ts('open_title')}>
        <form onSubmit={openSession} className="space-y-3">
          <p className="text-xs text-muted">{t('open_to_start')}</p>
          <div className="space-y-1.5">
            <Label htmlFor="pos-device">{ts('device')}</Label>
            <select id="pos-device" value={deviceId} onChange={(e) => setDeviceId(e.target.value)} required disabled={sessionBusy || devices.length === 0} className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60">
              <option value="">{ts('select_device')}</option>
              {devices.map((device) => <option key={device.id} value={device.id}>{device.name}{device.code ? ` · ${device.code}` : ''}{device.warehouse ? ` — ${device.warehouse.name}` : ''}</option>)}
            </select>
            {devices.length === 0 && <p className="text-xs text-warning">{ts('no_device')}</p>}
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="pos-shift">{ts('work_shift')} <span className="text-muted">({ts('optional')})</span></Label>
            <select id="pos-shift" value={shiftId} onChange={(e) => setShiftId(e.target.value)} disabled={sessionBusy} className="h-10 w-full rounded-md border border-border bg-surface px-3 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:cursor-not-allowed disabled:opacity-60">
              <option value="">{ts('optional')}</option>
              {shifts.map((shift) => <option key={shift.id} value={shift.id}>{shift.name}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ob">{ts('opening_balance')}</Label>
            <Input id="ob" className="num text-end" inputMode="decimal" value={openBal} onChange={(e) => setOpenBal(e.target.value)} required autoFocus />
          </div>
          {sessionError && <p className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{sessionError}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button asChild type="button" variant="outline"><Link href='/dashboard'>{t('leave')}</Link></Button>
            <Button type="submit" disabled={sessionBusy || !deviceId}>{ts('open')}</Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={unsavedExitAction !== null} onClose={() => setUnsavedExitAction(null)} title={t('unsaved_carts_exit_title')}>
        <p className="text-sm leading-relaxed text-muted">{t('unsaved_carts_exit_description')}</p>
        <div className="mt-5 flex justify-end gap-2">
          <Button type="button" variant="outline" onClick={() => setUnsavedExitAction(null)}>{ts('cancel')}</Button>
          <Button type="button" variant="danger" onClick={() => void confirmUnsavedExit()}>{t('unsaved_carts_exit_confirm')}</Button>
        </div>
      </Dialog>

      {/* إغلاق الوردية: عدّ النقد → المتوقّع/الفرق يُحسبان في الخادم ثم نغادر. */}
      <Dialog open={closeOpen} onClose={() => setCloseOpen(false)} title={ts('close_title')}>
        <form onSubmit={closeSession} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="cb">{ts('counted')}</Label>
            <Input id="cb" className="num text-end" inputMode="decimal" value={countedBal} onChange={(e) => setCountedBal(e.target.value)} required autoFocus />
          </div>
          {sessionError && <p className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{sessionError}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setCloseOpen(false)}>{ts('cancel')}</Button>
            <Button type="submit" disabled={sessionBusy}>{ts('close')}</Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
