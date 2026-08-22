'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import {
  Search, Barcode, SlidersHorizontal, Star, Package, ImageIcon, Plus, Minus, Trash2,
  User, UserPlus, StickyNote, Clock, TrendingUp, Tag, LayoutGrid, Wrench, ShoppingCart,
  Users, MoreHorizontal, PauseCircle, Archive, Trash,
} from 'lucide-react';
import { useToast } from '@/components/ui/toast';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Button } from '@/components/ui/button';
import { api, ApiError } from '@/lib/api';
import { formatRiyal, riyalToMinor, extractInclusiveTax } from '@/lib/money';
import { getSystemTaxInclusive } from '@/lib/tax';
import { useBranches } from '@/lib/branch';
import type { Warehouse } from '@/lib/warehouse';
import { ReceiptDialog, type Receipt } from '@/components/pos/receipt-dialog';
import { PosTopbar } from '@/components/pos/pos-topbar';
import { PosShortcuts } from '@/components/pos/pos-shortcuts';
import { PosPayment, type PaymentSummaryItem, type PosPaymentMethod, type PosTender } from '@/components/pos/pos-payment';
import { PosExchangeDialog } from '@/components/pos/pos-exchange-dialog';
import { PosHeldSalesDialog, type PosHeldSale } from '@/components/pos/pos-held-sales-dialog';
import { PosReturnDialog } from '@/components/pos/pos-return-dialog';
import { CustomerPickerDialog, type PosCustomer } from '@/components/pos/customer-picker';
import { buildInvoiceDocumentModel, type SourceInvoice, type SourceCompany } from '@/modules/documents/builder/from-invoice';

const WALKIN = 'عميل نقدي (POS)';

/** إعدادات نقطة البيع (sales-config/pos) — تُطبَّق فعلياً على تدفّق البيع. */
interface PosConfig {
  default_customer: string;
  receipt_footer: string;
  print_receipt: boolean;
  allow_discount: boolean;
  apply_customer_price_list: boolean;
  allow_unit_price_override: boolean;
  held_sale_close_policy: 'discard_on_session_close' | 'keep_for_next_session';
  enabled_payment_method_ids: string[];
  default_payment_method_id: string | null;
  allow_deferred_payment: boolean;
}
const POS_DEFAULTS: PosConfig = {
  default_customer: WALKIN,
  receipt_footer: '',
  print_receipt: true,
  allow_discount: true,
  apply_customer_price_list: true,
  allow_unit_price_override: false,
  held_sale_close_policy: 'discard_on_session_close',
  enabled_payment_method_ids: [],
  default_payment_method_id: null,
  allow_deferred_payment: true,
};

interface PosUnit { name: string; factor: number; price: string }
interface Product {
  id: string;
  sku: string | null;
  barcode: string | null;
  name: string;
  sale_price: string;
  pos_units: PosUnit[];
  tax_rate: number;
  type: string;
  track_inventory: boolean;
  quantity_on_hand: number;
  is_active: boolean;
}
interface CartLine { key: string; productId: string | null; description: string; sku: string | null; unit: string | null; price: string; qty: number; tax: number; discount: string }
interface PosDevice { id: string; name: string; code: string | null; warehouse_id: string; is_active: boolean; warehouse?: { id: string; code: string; name: string } | null }
interface WorkShift { id: string; name: string; is_active: boolean }
interface PosSession { id: string; number: string; status: string; pos_device_id?: string | null; warehouse_id?: string | null; shift_id?: string | null; pos_device?: { id: string; name: string; code: string | null } | null; warehouse?: { id: string; code: string; name: string } | null }

const FAV_KEY = 'nibras_pos_favs';
function stockTone(qty: number) {
  if (qty <= 20) return { w: Math.max(8, (qty / 20) * 40), c: 'var(--negative)' };
  if (qty <= 50) return { w: 40 + ((qty - 20) / 30) * 25, c: 'var(--warning)' };
  return { w: Math.min(100, 65 + ((qty - 50) / 200) * 35), c: 'var(--positive)' };
}

export default function PosPage() {
  const t = useTranslations('pos');
  const tc = useTranslations('common');
  const tprod = useTranslations('products');
  const router = useRouter();
  const { success, error: errorToast } = useToast();
  const searchRef = useRef<HTMLInputElement>(null);

  const [products, setProducts] = useState<Product[]>([]);
  const [catalogLoading, setCatalogLoading] = useState(true);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [warehouseId, setWarehouseId] = useState('');
  const [cashier, setCashier] = useState('—');
  const [companyName, setCompanyName] = useState('—');
  // الفرع المعروض: الفرع النشط (افتراضه الرئيسي)، وإلا اسم الشركة.
  const { active: activeBranch } = useBranches();
  const branch = activeBranch?.name ?? companyName;
  const [company, setCompany] = useState<SourceCompany | null>(null);
  const [search, setSearch] = useState('');
  const [cat, setCat] = useState<'all' | 'good' | 'service'>('all');
  const [tab, setTab] = useState('all');
  const [favs, setFavs] = useState<Set<string>>(new Set());
  const [cart, setCart] = useState<CartLine[]>([]);
  const [priceErrors, setPriceErrors] = useState<Record<string, string>>({});
  const [step, setStep] = useState<'sale' | 'payment'>('sale');
  const [mobileTab, setMobileTab] = useState<'products' | 'cart'>('products');
  const [receipt, setReceipt] = useState<Receipt | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [paying, setPaying] = useState(false);
  const [posCfg, setPosCfg] = useState<PosConfig>(POS_DEFAULTS);
  const [paymentMethods, setPaymentMethods] = useState<PosPaymentMethod[]>([]);
  const [paymentMethodsLoading, setPaymentMethodsLoading] = useState(true);
  const [paymentMethodsError, setPaymentMethodsError] = useState<string | null>(null);
  // وضع الضريبة من إعدادات النظام (متضمَّن/غير متضمَّن) — يوحّد سلوك كل المعاملات.
  const [taxInclusive, setTaxInclusive] = useState(false);
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
  const [sessionError, setSessionError] = useState<string | null>(null);
  const ts = useTranslations('posSessions');

  // العميل المختار (null = العميل النقدي الافتراضي). منتقي عملاء حقيقي.
  const [selectedCustomer, setSelectedCustomer] = useState<PosCustomer | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  const [heldCount, setHeldCount] = useState(0);
  const [holdBusy, setHoldBusy] = useState(false);
  const [retrieveOpen, setRetrieveOpen] = useState(false);

  // اسم العميل الافتراضي (النقدي) من الإعداد؛ والمعروض = المختار أو الافتراضي.
  const walkinName = posCfg.default_customer?.trim() || WALKIN;
  const customerName = selectedCustomer?.name ?? walkinName;

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
    setCart((current) => {
      let changed = false;
      const next = current.map((line) => {
        if (line.productId === null) return line;
        const price = products.find((product) => product.id === line.productId)?.sale_price;
        if (!price || price === line.price) return line;
        changed = true;
        return { ...line, price };
      });
      return changed ? next : current;
    });
  }, [posCfg.apply_customer_price_list, products]);

  useEffect(() => {
    api<{ data: Warehouse[] }>('/warehouses').then((r) => {
      const active = r.data.filter((warehouse) => warehouse.is_active);
      setWarehouses(active);
      setWarehouseId((current) => current || active.find((warehouse) => warehouse.is_default)?.id || active[0]?.id || '');
    }).catch(() => {});
    api<{ user?: { name?: string }; company?: { name?: string; vat_number?: string | null; cr_number?: string | null } }>('/me')
      .then((r) => {
        setCashier(r.user?.name ?? t('cashier'));
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
    getSystemTaxInclusive().then(setTaxInclusive).catch(() => {});
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
    const enabled = posCfg.enabled_payment_method_ids;
    return paymentMethods.filter((method) => enabled.length === 0 || enabled.includes(method.id));
  }, [paymentMethods, posCfg.enabled_payment_method_ids]);

  // قد تصل الإعدادات بعد أن يبدأ الكاشير سلةً مؤقتة؛ لا نترك خصماً معروضاً
  // أو محفوظاً عندما تكون السياسة الخادمية قد أوقفته.
  useEffect(() => {
    if (posCfg.allow_discount) return;
    setCart((current) => current.some((line) => riyalToMinor(line.discount) > 0)
      ? current.map((line) => ({ ...line, discount: '' }))
      : current);
  }, [posCfg.allow_discount]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return products.filter((p) => {
      if (cat !== 'all' && p.type !== cat) return false;
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

  function effectiveLinePrice(line: CartLine): string {
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
    setCart((current) => current.map((line) => {
      if (line.productId === null) return line;
      const product = products.find((item) => item.id === line.productId);
      const unit = product ? pricedUnit(product, line.unit) : undefined;
      return unit && (unit.name !== line.unit || unit.price !== line.price)
        ? { ...line, unit: unit.name, price: unit.price }
        : line;
    }));
  }, [posCfg.allow_unit_price_override, products]);

  function addProduct(p: Product) {
    const unit = pricedUnit(p, null);
    if (!unit) return;
    setCart((c) => {
      const ex = c.find((l) => l.productId === p.id && l.unit === unit.name);
      if (ex) return c.map((l) => (l.key === ex.key ? { ...l, qty: l.qty + 1 } : l));
      return [...c, { key: `${p.id}:${unit.name}`, productId: p.id, description: p.name, sku: p.sku, unit: unit.name, price: unit.price, qty: 1, tax: p.tax_rate, discount: '' }];
    });
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
  const normalizeUnitPrice = (k: string) => {
    const line = cart.find((current) => current.key === k);
    if (!line) return;

    const minor = riyalToMinor(line.price);
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
      setCart([]);
      setSelectedCustomer(null);
      setHeldCount((current) => current + 1);
      success(t('held_done'));
    } catch (err) {
      errorToast(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setHoldBusy(false);
    }
  }

  function retrieveSale(held: PosHeldSale) {
    setCart(held.items.map((item, index) => ({
      key: `${held.id}-${index}`,
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
    })));
    setSelectedCustomer(held.customer);
    setTaxInclusive(held.tax_inclusive);
    setRetrieveOpen(false);
    setStep('sale');
    setMobileTab('cart');
    setHeldCount((current) => Math.max(0, current - 1));
    success(t('held_resumed'));
  }

  // مسح باركود: مطابقة الكود بالـ SKU أو الباركود ثم الإضافة للسلة.
  function scanCode(code: string): boolean {
    const c = code.trim();
    if (!c) return false;
    const p = products.find((x) => (x.sku ?? '').trim() === c || (x.barcode ?? '').trim() === c);
    if (p) { addProduct(p); success(t('scan_added', { name: p.name })); return true; }
    errorToast(t('scan_not_found', { code: c }));
    return false;
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
  const lineCalc = (l: CartLine) => {
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

  async function closeSession(e: React.FormEvent) {
    e.preventDefault();
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

  async function ensureWalkin(): Promise<string> {
    const r = await api<{ data: { id: string; name: string }[] }>('/partners');
    const found = r.data.find((p) => p.name === walkinName);
    if (found) return found.id;
    const created = await api<{ data: { id: string } }>('/partners', { method: 'POST', body: { name: walkinName, type: 'customer' } });
    return created.data.id;
  }

  const confirmPayment = useCallback(
    async (tenders: PosTender[]) => {
      if (catalogLoading) {
        setError(t('price_list_loading'));
        return;
      }
      if (cart.length === 0) return;
      if (!session) {
        setError(t('open_to_start'));
        return;
      }
      setPaying(true);
      setError(null);
      try {
        // العميل المختار إن وُجد، وإلا العميل النقدي الافتراضي.
        const partnerId = selectedCustomer?.id ?? (await ensureWalkin());
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
        const created = await api<{ data: { id: string; number: string; total: string } }>('/pos/checkout', {
          method: 'POST',
          body: { partner_id: partnerId, pos_session_id: session.id, warehouse_id: warehouseId || null, tax_inclusive: taxInclusive, items, tenders },
        });
        const z = await api<{ qr: string | null }>(`/invoices/${created.data.id}/zatca`);
        success(t('sale_done'));

        // بناء نموذج الإيصال الحراري من السلة (بلا نداء إضافي) عبر محرّك المستندات.
        const toRiyal = (m: number) => (m / 100).toFixed(2);
        const totals = cart.reduce(
          (a, l) => { const c = lineCalc(l); return { sub: a.sub + c.net, tax: a.tax + c.tax, tot: a.tot + c.total }; },
          { sub: 0, tax: 0, tot: 0 },
        );
        // نوع الدفع للعرض: مسدّد فوراً بأي وسيلة مهيأة، وإلا آجل.
        const paidNow = tenders.reduce((sum, tender) => sum + tender.amount, 0);
        const receiptInvoice: SourceInvoice = {
          number: created.data.number,
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
          customer: { name: selectedCustomer?.name ?? walkinName, vat_number: null, city: null },
          qr: z.qr,
          footerText: posCfg.receipt_footer,
        });
        setReceipt({ model, number: created.data.number });
        setCart([]);
        setStep('sale');
        setMobileTab('products');
      } catch (e) {
        setError(e instanceof ApiError ? e.message : tc('saveFailed'));
      } finally {
        setPaying(false);
      }
    },
    [cart, catalogLoading, success, t, tc, selectedCustomer, walkinName, posCfg.receipt_footer, posCfg.allow_discount, posCfg.allow_unit_price_override, taxInclusive, company, warehouseId, session, products],
  );

  const summaryItems: PaymentSummaryItem[] = cart.map((l) => ({
    name: l.unit ? `${l.description} (${l.unit})` : l.description, qty: l.qty, unitPrice: formatRiyal(effectiveLinePrice(l)), lineTotal: lineCalc(l).total,
  }));

  const CATS = [
    { key: 'all' as const, label: t('cat_all'), icon: LayoutGrid },
    { key: 'good' as const, label: t('cat_goods'), icon: Package },
    { key: 'service' as const, label: t('cat_services'), icon: Wrench },
  ];
  const TABS = [
    { key: 'all', label: t('tab_all'), icon: null },
    { key: 'recent', label: t('tab_recent'), icon: Clock },
    { key: 'top', label: t('tab_top'), icon: TrendingUp },
    { key: 'offers', label: t('tab_offers'), icon: Tag },
    { key: 'favorites', label: t('tab_favorites'), icon: Star },
  ];

  // ── لوحات فرعية ──────────────────────────────────────────────
  const productsPanel = (
    <section className="flex min-h-0 flex-col gap-4 overflow-y-auto p-4 lg:p-5">
      <div className="flex gap-2.5">
        <button
          type="button"
          onClick={() => searchRef.current?.focus()}
          className="flex items-center gap-2 rounded-xl border border-border bg-surface px-4 text-[13px] font-semibold shadow-sm hover:border-primary"
        >
          <Barcode className="h-4 w-4" strokeWidth={1.8} />
          <span className="hidden sm:inline">{t('barcode_search')}</span>
        </button>
        <div className="flex flex-1 items-center gap-2.5 rounded-xl border border-border bg-surface px-3.5 py-2.5 shadow-sm">
          <Search className="h-4 w-4 text-muted" strokeWidth={1.8} />
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => {
              // Enter في البحث: إن طابق النصّ كوداً بالضبط أُضيف المنتج ونُظّف الحقل.
              if (e.key === 'Enter' && search.trim()) {
                const c = search.trim();
                const p = products.find((x) => (x.sku ?? '').trim() === c || (x.barcode ?? '').trim() === c);
                if (p) { e.preventDefault(); addProduct(p); success(t('scan_added', { name: p.name })); setSearch(''); }
              }
            }}
            placeholder={t('search_products')}
            className="w-full bg-transparent text-[13px] text-text outline-none placeholder:text-muted"
          />
          <kbd className="num hidden rounded border border-border bg-background px-1.5 py-0.5 text-[10px] text-muted sm:block">F4</kbd>
        </div>
        <button className="hidden items-center gap-2 rounded-xl border border-border bg-surface px-4 text-[13px] font-semibold shadow-sm sm:flex">
          <SlidersHorizontal className="h-4 w-4" strokeWidth={1.8} />
          {t('filter')}
        </button>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        {TABS.map((qt) => {
          const Icon = qt.icon;
          const on = tab === qt.key;
          return (
            <button
              key={qt.key}
              onClick={() => setTab(qt.key)}
              className={'flex items-center gap-1.5 rounded-lg border px-3.5 py-2 text-[12.5px] font-semibold ' + (on ? 'border-transparent bg-primary text-white' : 'border-border bg-surface text-muted')}
            >
              {Icon && <Icon className="h-3.5 w-3.5" strokeWidth={1.8} />}
              {qt.label}
            </button>
          );
        })}
      </div>

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {filtered.map((p) => {
          const tracked = p.track_inventory;
          const st = stockTone(p.quantity_on_hand);
          const fav = favs.has(p.id);
          return (
            <button
              key={p.id}
              onClick={() => addProduct(p)}
              className="relative flex flex-col rounded-2xl border-[1.5px] border-border bg-surface p-3 text-start shadow-sm hover:-translate-y-px hover:border-primary"
            >
              <span
                role="button"
                tabIndex={-1}
                onClick={(e) => { e.stopPropagation(); toggleFav(p.id); }}
                className={'absolute end-2.5 top-2.5 grid h-6 w-6 place-items-center ' + (fav ? 'text-warning' : 'text-border')}
              >
                <Star className="h-4 w-4" strokeWidth={1.8} fill={fav ? 'currentColor' : 'none'} />
              </span>
              <div className="mb-3 grid aspect-square w-full place-items-center rounded-xl bg-background">
                <ImageIcon className="h-8 w-8 text-border" strokeWidth={1.3} />
              </div>
              <span className="line-clamp-2 min-h-[36px] text-[13px] font-semibold leading-snug text-text">{p.name}</span>
              {p.sku && <span className="num mb-1.5 mt-0.5 text-[10.5px] text-muted">{p.sku}</span>}
              <span className="num text-[15px] font-bold text-primary-hover">{formatRiyal(p.sale_price)}</span>
              <span className="text-[9px] text-muted">{taxInclusive ? tprod('tax_incl_tag') : tprod('tax_excl_tag')}</span>
              {tracked && (
                <div className="mt-2">
                  <div className="mb-1 h-1 overflow-hidden rounded bg-border">
                    <i className="block h-full" style={{ width: `${st.w}%`, background: st.c }} />
                  </div>
                  <span className="num text-[10.5px] text-muted">{t('available')}: {p.quantity_on_hand}</span>
                </div>
              )}
            </button>
          );
        })}
        {filtered.length === 0 && <p className="col-span-full py-10 text-center text-sm text-muted">{t('no_products')}</p>}
      </div>
    </section>
  );

  const cartPanel = (
    <aside className="flex min-h-0 flex-col overflow-hidden border-border bg-surface lg:border-e">
      <div className="border-b border-border p-3.5">
        <div className="mb-2.5 flex items-center gap-2">
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className={'flex flex-1 items-center justify-between rounded-[10px] border bg-background px-3 py-2.5 text-[12.5px] font-semibold ' + (selectedCustomer ? 'border-primary text-primary-hover' : 'border-border')}
          >
            <span className="truncate">{customerName}</span>
            <User className="h-[15px] w-[15px] shrink-0 text-muted" strokeWidth={1.7} />
          </button>
          <button
            type="button"
            onClick={() => setPickerOpen(true)}
            className="grid h-9 w-9 place-items-center rounded-[10px] border border-border bg-surface hover:border-primary"
            aria-label={t('add_customer')}
          >
            <UserPlus className="h-4 w-4" strokeWidth={1.8} />
          </button>
        </div>
        <div className="flex items-center gap-2 text-[13px] font-bold">
          {t('cart')}
          <span className="num grid h-5 min-w-5 place-items-center rounded-md bg-primary px-1.5 text-[11px] font-bold text-white">{count}</span>
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3.5">
        {cart.length === 0 && <p className="py-10 text-center text-sm text-muted">{t('empty_cart')}</p>}
        {cart.map((l) => {
          const units = l.productId ? products.find((product) => product.id === l.productId)?.pos_units ?? [] : [];
          return (
          <div key={l.key} className="flex items-center gap-2.5 border-b border-border py-3 last:border-0">
            <button onClick={() => remove(l.key)} className="grid h-6 w-6 shrink-0 place-items-center rounded-md bg-negative/10 text-negative" aria-label={t('remove')}>
              <Trash2 className="h-3 w-3" strokeWidth={2} />
            </button>
            <div className="flex shrink-0 items-center gap-1.5">
              <button onClick={() => setQty(l.key, -1)} className="grid h-[22px] w-[22px] place-items-center rounded-md border border-border bg-background"><Minus className="h-3 w-3" /></button>
              <span className="num w-4 text-center text-[12.5px] font-bold">{l.qty}</span>
              <button onClick={() => setQty(l.key, 1)} className="grid h-[22px] w-[22px] place-items-center rounded-md border border-border bg-background"><Plus className="h-3 w-3" /></button>
            </div>
            <div className="grid h-[34px] w-[34px] shrink-0 place-items-center rounded-lg bg-background"><Package className="h-4 w-4 text-border" strokeWidth={1.6} /></div>
            <div className="min-w-0 flex-1">
              <div className="truncate text-xs font-semibold">{l.description}</div>
              {l.productId !== null && units.length > 1 ? (
                <div className="mt-0.5 flex items-center gap-1">
                  <label htmlFor={`unit-${l.key}`} className="text-[10px] text-muted">{tprod('unit')}</label>
                  <select
                    id={`unit-${l.key}`}
                    value={l.unit ?? ''}
                    onChange={(event) => setUnit(l.key, event.target.value)}
                    className="h-5 max-w-24 rounded border border-border bg-background px-1 text-[10px] text-text outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                  >
                    {units.map((unit) => <option key={unit.name} value={unit.name}>{unit.name}</option>)}
                  </select>
                </div>
              ) : l.unit ? <div className="text-[10px] text-muted">{l.unit}</div> : null}
              {(posCfg.allow_unit_price_override || posCfg.allow_discount) ? (
                <div className="mt-0.5 space-y-1">
                  {posCfg.allow_unit_price_override && (
                    <div className="flex items-center gap-1">
                      <label htmlFor={`unit-price-${l.key}`} className="text-[10px] text-muted">{t('unit_price')}</label>
                      <input
                        id={`unit-price-${l.key}`}
                        value={l.price}
                        onChange={(e) => setUnitPrice(l.key, e.target.value)}
                        onBlur={() => normalizeUnitPrice(l.key)}
                        inputMode="decimal"
                        aria-invalid={Boolean(priceErrors[l.key])}
                        aria-describedby={priceErrors[l.key] ? `unit-price-error-${l.key}` : undefined}
                        className="num w-16 rounded border border-border bg-background px-1 py-0.5 text-end text-[10px] text-text outline-none focus:border-primary aria-[invalid=true]:border-negative"
                      />
                    </div>
                  )}
                  {priceErrors[l.key] && <p id={`unit-price-error-${l.key}`} className="text-[10px] text-negative">{priceErrors[l.key]}</p>}
                  {posCfg.allow_discount && (
                    <div className="flex items-center gap-1">
                      <span className="text-[10px] text-muted">{t('discount')}</span>
                      <input
                        value={l.discount}
                        onChange={(e) => setDiscount(l.key, e.target.value)}
                        inputMode="decimal"
                        placeholder="0"
                        className="num w-14 rounded border border-border bg-background px-1 py-0.5 text-end text-[10px] text-text outline-none focus:border-primary"
                      />
                    </div>
                  )}
                </div>
              ) : (
                l.sku && <div className="num text-[10px] text-muted">{l.sku}</div>
              )}
            </div>
            <div className="num shrink-0 text-[12.5px] font-bold">{formatRiyal(lineCalc(l).total / 100)}</div>
          </div>
          );
        })}
      </div>

      <div className="space-y-2 p-3">
        <div className="grid grid-cols-2 gap-2">
          <button
            type="button"
            onClick={holdSale}
            disabled={cart.length === 0 || !session || holdBusy || catalogLoading}
            className="flex items-center justify-center gap-1.5 rounded-[9px] border border-border bg-surface px-3 py-2 text-[11.5px] font-semibold text-text hover:border-primary disabled:opacity-50"
          >
            <PauseCircle className="h-3.5 w-3.5" strokeWidth={1.8} />
            {t('hold')}
          </button>
          <button
            type="button"
            onClick={() => setRetrieveOpen(true)}
            disabled={!session}
            className="flex items-center justify-center gap-1.5 rounded-[9px] border border-border bg-surface px-3 py-2 text-[11.5px] font-semibold text-text hover:border-primary disabled:opacity-50"
          >
            <Archive className="h-3.5 w-3.5" strokeWidth={1.8} />
            {t('held')}
            {heldCount > 0 && <span className="num rounded bg-primary px-1.5 text-[10px] font-bold text-white">{heldCount}</span>}
          </button>
        </div>
        <button className="flex w-full items-center gap-2 rounded-[9px] border border-dashed border-border bg-background px-3 py-2 text-[11.5px] text-muted">
          <StickyNote className="h-3.5 w-3.5" strokeWidth={1.7} />
          {t('invoice_note')}
        </button>
      </div>

      <div className="flex flex-col gap-1.5 border-t border-border bg-background p-3.5">
        <div className="flex justify-between text-[12.5px]"><span className="text-muted">{t('subtotal')}</span><span className="num font-semibold">{formatRiyal(subMinor / 100)}</span></div>
        {discMinor > 0 && (
          <div className="flex justify-between text-[12.5px]"><span className="text-muted">{t('discount')}</span><span className="num font-semibold text-positive">−{formatRiyal(discMinor / 100)}</span></div>
        )}
        <div className="flex justify-between text-[12.5px]"><span className="text-muted">{t('tax')}</span><span className="num font-semibold">{formatRiyal(taxMinor / 100)}</span></div>
        <div className="flex items-baseline justify-between border-t border-border pt-2">
          <span className="text-sm font-bold">{t('total')}</span>
          <span className="num text-[22px] font-extrabold text-primary-hover">{formatRiyal(totalMinor / 100)}</span>
        </div>
      </div>

      <div className="p-3.5 pt-0">
        <button
          onClick={() => setStep('payment')}
          disabled={cart.length === 0 || catalogLoading}
          className="flex w-full items-center justify-between rounded-xl bg-primary px-4 py-3.5 text-base font-bold text-white disabled:opacity-50"
        >
          {t('pay')}
          <kbd className="num rounded-md bg-white/20 px-2 py-0.5 text-xs">F9</kbd>
        </button>
      </div>
    </aside>
  );

  const catsPanel = (
    <aside className="hidden flex-col gap-2 overflow-y-auto border-s border-border bg-surface p-4 lg:flex">
      <h4 className="mb-1 px-1 text-xs font-bold text-muted">{t('categories')}</h4>
      {CATS.map(({ key, label, icon: Icon }) => {
        const on = cat === key;
        return (
          <button
            key={key}
            onClick={() => setCat(key)}
            className={'flex items-center gap-3 rounded-[11px] border px-3 py-3 text-[13px] font-semibold ' + (on ? 'border-transparent bg-primary-soft text-primary-hover' : 'border-transparent text-text hover:bg-background')}
          >
            <span className="grid h-[26px] w-[26px] place-items-center rounded-md bg-primary-soft text-primary-hover"><Icon className="h-3.5 w-3.5" strokeWidth={1.8} /></span>
            {label}
          </button>
        );
      })}
    </aside>
  );

  return (
    <div className="flex h-full flex-col overflow-hidden bg-background">
      <PosTopbar
        cashier={cashier}
        branch={branch}
        session={session}
        warehouses={warehouses}
        warehouseId={warehouseId}
        warehouseDisabled={Boolean(session?.warehouse_id) || step === 'payment' || paying}
        onWarehouseChange={setWarehouseId}
        onEndSession={() => (session ? (setCountedBal(''), setSessionError(null), setCloseOpen(true)) : router.push('/dashboard'))}
        onReturn={() => setReturnOpen(true)}
        onExchange={() => setExchangeOpen(true)}
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
          <div className="grid min-h-0 flex-1 grid-cols-1 overflow-hidden lg:grid-cols-[300px_1fr_230px]">
            <div className={mobileTab === 'cart' ? 'flex min-h-0' : 'hidden lg:flex lg:min-h-0'}>{cartPanel}</div>
            <div className={mobileTab === 'products' ? 'relative flex min-h-0 flex-col' : 'hidden lg:flex lg:min-h-0 lg:flex-col'}>
              {productsPanel}
              {/* شريط سلة عائم (جوال فقط) */}
              {count > 0 && (
                <button
                  onClick={() => setMobileTab('cart')}
                  className="absolute inset-x-4 bottom-3 flex items-center gap-3 rounded-2xl bg-primary px-4 py-3 text-white shadow-lg lg:hidden"
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
            <div className="flex flex-col items-center justify-center gap-1 text-[10.5px] font-semibold text-muted"><MoreHorizontal className="h-5 w-5" strokeWidth={1.8} />{t('nav_more')}</div>
            <div className="flex flex-col items-center justify-center gap-1 text-[10.5px] font-semibold text-muted"><Users className="h-5 w-5" strokeWidth={1.8} />{t('nav_customers')}</div>
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

      <ReceiptDialog receipt={receipt} autoPrint={posCfg.print_receipt} onClose={() => setReceipt(null)} />
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
        onExchanged={(number) => { setExchangeOpen(false); setCart([]); setSelectedCustomer(null); setStep('sale'); setMobileTab('products'); success(t('exchange_done', { number })); }}
      />

      <CustomerPickerDialog
        open={pickerOpen}
        walkinLabel={walkinName}
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
            <Button type="button" variant="outline" onClick={() => router.push('/dashboard')}>{t('leave')}</Button>
            <Button type="submit" disabled={sessionBusy || !deviceId}>{ts('open')}</Button>
          </div>
        </form>
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
