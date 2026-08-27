'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Plus, FileText, Users, ShoppingCart, StickyNote, Tag, Wallet } from 'lucide-react';
import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FieldGrid, FieldSpan, FormActions, FormAlert, FormPage, FormSection } from '@/components/nebrax';
import { InvoiceLineRow, LINE_GRID } from '@/components/invoices/invoice-line-row';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NumberPreviewField } from '@/components/ui/number-preview-field';
import { Select } from '@/components/ui/select';
import { Combobox, type ComboOption } from '@/components/ui/combobox';
import { PartnerDialog } from '@/components/partners/partner-dialog';
import { ProductDialog } from '@/components/products/product-dialog';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { useNumberPreview } from '@/lib/use-number-preview';
import { cn } from '@/lib/utils';
import { SAUDI_RIYAL_SYMBOL, formatRiyal, riyalToMinor } from '@/lib/money';
import type { Warehouse } from '@/lib/warehouse';

interface Partner {
  id: string; name: string; type?: string; code?: string | null; phone?: string | null; vat_number?: string | null;
  default_price_list_id?: string | null;
  default_price_list?: { id: string; name: string; is_active: boolean } | null;
}
interface ProductUnit { name: string; factor: number }
interface Product {
  id: string; name: string; sku?: string | null; barcode?: string | null;
  sale_price: string; min_sale_price?: string | null; tax_rate: number; is_active: boolean;
  track_inventory?: boolean; quantity_on_hand?: number; units?: ProductUnit[];
}
interface CostCenter { id: string; code: string; name: string; is_active: boolean }
interface Employee { id: string; name: string }
interface Account { id: string; code: string; name: string; type: string; is_group: boolean }
interface PriceList { id: string; name: string; is_active: boolean; items_count?: number }
interface PriceListResolution { matched: boolean; price: string | null }
type AllocationKind = 'none' | 'single' | 'multiple';
type AllocationInputMode = 'percent' | 'amount';
interface LineAllocation { costCenterId: string; value: string }
interface Line {
  key: string; productId: string | null; description: string; qty: string; price: string; tax: string; disc: string; unit: string;
  allocationKind: AllocationKind; allocationInputMode: AllocationInputMode; allocations: LineAllocation[];
  minimumPriceOverrideReason: string;
}
interface ApiLineAllocation { cost_center_id: string; mode: AllocationInputMode; basis_points: number; amount: string }
interface ApiLine {
  product_id: string | null; description: string | null; quantity: number; unit_name: string | null; unit_price: string; tax_rate: number; line_discount: string;
  cost_center_allocations?: ApiLineAllocation[];
  minimum_price_override?: { reason: string; approved_by_user_id: string } | null;
}
interface ApiInvoice {
  status: string; partner_id: string; warehouse_id: string | null; price_list_id?: string | null; payment_type: string; invoice_date: string; due_date: string | null;
  cost_center_id: string | null; salesperson_id: string | null; discount: string; shipping: string;
  adjustment: string; tax_inclusive: boolean; zatca_document_type: 'standard' | 'simplified' | null; notes: string | null; lines: ApiLine[];
  is_paid?: boolean; payment_method?: string | null; payment_reference?: string | null; cash_account_id?: string | null;
}
interface TaxDef { name: string; rate: number; inclusive: boolean }

let lineSeq = 0;
// الكمية تبدأ فارغة لا `1`، كما في فاتورة الشراء: الواحد الافتراضي يمرّ دون أن
// يقرأه أحد فتُحفظ فاتورةٌ بكمية لم يقصدها المستخدم.
const newLine = (): Line => ({
  key: `l${++lineSeq}`, productId: null, description: '', qty: '', price: '', tax: '15', disc: '', unit: '',
  allocationKind: 'none', allocationInputMode: 'percent', allocations: [], minimumPriceOverrideReason: '',
});

/**
 * سطرٌ لم يُمسّ بعد — لا منتج ولا وصف ولا سعر ولا خصم.
 *
 * سطر المبيعات يقبل وصفاً حرّاً بلا منتج، فلا يصلح شرط «منتج على كل سطر» الذي
 * يحرس فاتورة الشراء. والسطر الفارغ تماماً يُسقطه `submit` أصلاً بلا ضرر، فلا
 * يُمنع الحفظ بسببه — بخلاف سطرٍ كُتب فيه شيءٌ ثم تُركت كميتُه فارغة.
 */
function isUntouchedLine(line: Line): boolean {
  return !line.productId && !line.description.trim() && !line.price.trim() && !line.disc.trim();
}

/** الكمية صالحة إذا كانت عدداً موجباً لا يقلّ عن واحد — يطابق `integer|min:1` في الخادم. */
function hasValidQty(line: Line): boolean {
  const raw = line.qty.trim();
  if (raw === '') return false;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 1;
}

/** تحويل واجهة النسبة إلى نقاط أساس بلا تعويم: «60.25» ← 6025. */
function percentToBasisPoints(value: string): number | null {
  const normalized = value.trim()
    .replace(/[٠-٩]/g, (digit) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(digit)))
    .replace(/[٫]/g, '.')
    .replace(/[,٬\s]/g, '');
  if (!/^\d+(?:\.\d{0,2})?$/.test(normalized)) return null;
  const [whole, fraction = ''] = normalized.split('.');
  const basisPoints = Number(whole) * 100 + Number((fraction + '00').slice(0, 2));
  return Number.isSafeInteger(basisPoints) ? basisPoints : null;
}

function basisPointsToPercent(value: number): string {
  const whole = Math.floor(value / 100);
  const fraction = String(value % 100).padStart(2, '0');
  return fraction === '00' ? String(whole) : `${whole}.${fraction}`;
}

/** يضيف عدداً من الأيام إلى تاريخ YYYY-MM-DD ويعيد YYYY-MM-DD (بلا مناطق زمنية). */
function addDays(date: string, days: number): string {
  if (!date) return '';
  const [y, m, d] = date.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + days);
  return dt.toISOString().slice(0, 10);
}

/**
 * نموذج الفاتورة — إنشاء أو تعديل (مسوّدة فقط). عند تمرير editId يُحمَّل المستند ويُملأ،
 * والحفظ يستخدم PUT بدل POST. المرحّلة غير قابلة للتعديل (يحرسها الـ backend).
 */
export function InvoiceForm({ editId }: { editId?: string }) {
  const t = useTranslations('invoiceForm');
  const td = useTranslations('deliveryNotes');
  const tc = useTranslations('common');
  const router = useRouter();
  const { success } = useToast();

  const [partners, setPartners] = useState<Partner[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [centers, setCenters] = useState<CostCenter[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [cashAccounts, setCashAccounts] = useState<Account[]>([]);
  const [priceLists, setPriceLists] = useState<PriceList[]>([]);
  const [partnerId, setPartnerId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [priceListId, setPriceListId] = useState('');
  const [centerId, setCenterId] = useState('');
  const [salespersonId, setSalespersonId] = useState('');
  const [date, setDate] = useState('');
  const [dueDate, setDueDate] = useState('');
  const [terms, setTerms] = useState('');
  const [notes, setNotes] = useState('');
  const [discountMode, setDiscountMode] = useState<'amount' | 'percent'>('amount');
  const [discountInput, setDiscountInput] = useState('');
  const [shippingInput, setShippingInput] = useState('');
  const [adjustmentInput, setAdjustmentInput] = useState('');
  const [taxInclusive, setTaxInclusive] = useState(false);
  const [zatcaDocumentType, setZatcaDocumentType] = useState<'standard' | 'simplified' | null>('simplified');
  // ═══ السداد الفوري («مدفوع بالفعل») ═══
  // الخانة وحدها تحكم **إرسال** التفاصيل؛ وقيم الحقول تعيش هنا مستقلّةً عنها،
  // فإخفاؤها لا يمسّها ورفعُ الإخفاء يُظهرها كما تُركت (نقطة الاختبار D).
  const [isPaid, setIsPaid] = useState(false);
  const [payMethod, setPayMethod] = useState('cash');
  const [payReference, setPayReference] = useState('');
  const [cashAccountId, setCashAccountId] = useState('');
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [applyingPriceList, setApplyingPriceList] = useState(false);
  const [loadingDoc, setLoadingDoc] = useState(!!editId);
  const [newPartner, setNewPartner] = useState(false);
  // السطر الذي فُتحت من منتقيه نافذة «منتج جديد» — ليُختار فيه فور الحفظ.
  const [newProductFor, setNewProductFor] = useState<string | null>(null);
  const { number: suggestedNumber, loading: loadingNumber } = useNumberPreview('invoice', { date, enabled: !editId });

  const selectPartner = useCallback((nextPartnerId: string, availablePartners = partners) => {
    setPartnerId(nextPartnerId);
    // الفاتورة المحررة تستعيد قائمتها المحفوظة؛ أما المسودة الجديدة فتبدأ
    // باقتراح العميل فقط. الاختيار اليدوي اللاحق في حقل القائمة يظل حراً.
    if (!editId) {
      const partner = availablePartners.find((candidate) => candidate.id === nextPartnerId);
      setPriceListId(partner?.default_price_list?.is_active ? partner.default_price_list.id : '');
      setZatcaDocumentType(/^\d{15}$/.test(partner?.vat_number ?? '') ? 'standard' : 'simplified');
    }
  }, [editId, partners]);

  const loadPartners = useCallback(
    (selectFirst = false) =>
      // `?type=customer` ⇒ `whereIn('type', ['customer','both'])` في الخادم — نفس ما
      // تستعمله شاشة العملاء وسند القبض. بلا هذه الفلترة يظهر المورّدون خيارات
      // عميلٍ لفاتورة مبيعات، وقد يُختار أحدهم تلقائياً لو تصدّر القائمة.
      api<{ data: Partner[] }>('/partners?type=customer')
        .then((r) => {
          setPartners(r.data);
          if (selectFirst && r.data[0]) {
            selectPartner(r.data[0].id, r.data);
          }
        })
        .catch(() => {}),
    [selectPartner]
  );

  const loadProducts = useCallback(
    () => api<{ data: Product[] }>('/products')
      .then((r) => setProducts(r.data.filter((p) => p.is_active)))
      .catch(() => {}),
    []
  );

  useEffect(() => {
    setDate(new Date().toISOString().slice(0, 10));
    loadPartners(!editId); // الافتراضي للإنشاء فقط
    loadProducts();
    api<{ data: CostCenter[] }>('/cost-centers').then((r) => setCenters(r.data.filter((c) => c.is_active))).catch(() => {});
    api<{ data: Warehouse[] }>('/warehouses').then((r) => {
      const active = r.data.filter((warehouse) => warehouse.is_active);
      setWarehouses(active);
      if (!editId) setWarehouseId((current) => current || active.find((warehouse) => warehouse.is_default)?.id || active[0]?.id || '');
    }).catch(() => {});
    api<{ data: Employee[] }>('/employees').then((r) => setEmployees(r.data)).catch(() => {});
    api<{ data: PriceList[] }>('/price-lists').then((r) => setPriceLists(r.data)).catch(() => {});
    // خزائن التحصيل: حسابات النقد والبنوك الفرعية وحدها (111x/112x) — وهو
    // المدى نفسه الذي يقبله `PaymentService`، فلا تُعرَض خزينة يرفضها الخادم.
    api<{ data: Account[] }>('/accounts')
      .then((r) => setCashAccounts(r.data.filter((a) => !a.is_group && a.type === 'asset' && /^11[12]/.test(a.code))))
      .catch(() => {});
    // الافتراضي للإنشاء: من إعدادات الضرائب (هل الضريبة الرئيسية «متضمَّنة»؟).
    if (!editId) {
      api<{ data: TaxDef[] }>('/sales-config/taxes')
        .then((r) => {
          const primary = r.data.find((x) => Number(x.rate) > 0) ?? r.data[0];
          if (primary?.inclusive) setTaxInclusive(true);
        })
        .catch(() => {});
    }
  }, [editId]);

  // تحميل المستند للتعديل وملء الحقول.
  useEffect(() => {
    if (!editId) return;
    setLoadingDoc(true);
    api<{ data: ApiInvoice }>(`/invoices/${editId}`)
      .then((r) => {
        const inv = r.data;
        if (inv.status !== 'draft') { router.replace(`/invoices/${editId}`); return; } // المرحّلة لا تُعدَّل
        setPartnerId(inv.partner_id);
        setWarehouseId(inv.warehouse_id ?? '');
        setPriceListId(inv.price_list_id ?? '');
        setIsPaid(!!inv.is_paid);
        setPayMethod(inv.payment_method ?? 'cash');
        setPayReference(inv.payment_reference ?? '');
        setCashAccountId(inv.cash_account_id ?? '');
        setDate(inv.invoice_date ?? '');
        setDueDate(inv.due_date ?? '');
        setCenterId(inv.cost_center_id ?? '');
        setSalespersonId(inv.salesperson_id ?? '');
        setNotes(inv.notes ?? '');
        setShippingInput(Number(inv.shipping) > 0 ? inv.shipping : '');
        setAdjustmentInput(Number(inv.adjustment) !== 0 ? inv.adjustment : '');
        setTaxInclusive(!!inv.tax_inclusive);
        // لا نحوّل المسودات السابقة ذات القيمة null إلى Simplified في الواجهة؛
        // يبقى القرار غير محسوم كي يطبّق الخادم استدلال VAT الموحّد عند الحفظ.
        setZatcaDocumentType(inv.zatca_document_type);
        setDiscountMode('amount'); // يُخزَّن الخصم كمبلغ مطلق
        setDiscountInput(Number(inv.discount) > 0 ? inv.discount : '');
        setLines(
          inv.lines.length
            ? inv.lines.map((l) => ({
                key: `l${++lineSeq}`,
                productId: l.product_id,
                description: l.description ?? '',
                qty: String(l.quantity),
                unit: l.unit_name ?? '',
                price: l.unit_price,
                tax: String(l.tax_rate),
                disc: Number(l.line_discount) > 0 ? l.line_discount : '',
                allocationKind: !l.cost_center_allocations?.length
                  ? 'none'
                  : l.cost_center_allocations.length === 1 ? 'single' : 'multiple',
                allocationInputMode: l.cost_center_allocations?.[0]?.mode ?? 'percent',
                allocations: (l.cost_center_allocations ?? []).map((allocation) => ({
                  costCenterId: allocation.cost_center_id,
                  value: allocation.mode === 'percent'
                    ? basisPointsToPercent(allocation.basis_points)
                    : allocation.amount,
                })),
                minimumPriceOverrideReason: l.minimum_price_override?.reason ?? '',
              }))
            : [newLine()]
        );
      })
      .catch(() => setError(tc('saveFailed')))
      .finally(() => setLoadingDoc(false));
  }, [editId, router, tc]);

  function applyTerms(days: string, baseDate = date) {
    setTerms(days);
    const n = Number(days);
    if (baseDate && days !== '' && !Number.isNaN(n)) setDueDate(addDays(baseDate, n));
  }
  function changeDate(v: string) {
    setDate(v);
    if (terms !== '') setDueDate(addDays(v, Number(terms) || 0));
  }

  const setLine = (key: string, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addLine = () => setLines((ls) => [...ls, newLine()]);
  const removeLine = (key: string) => setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== key) : ls));
  const setAllocationKind = (key: string, allocationKind: AllocationKind) => setLines((ls) => ls.map((line) => {
    if (line.key !== key) return line;
    if (allocationKind === 'none') return { ...line, allocationKind, allocations: [] };
    if (allocationKind === 'single') {
      const first = line.allocations[0];
      return {
        ...line,
        allocationKind,
        allocations: [{
          costCenterId: first?.costCenterId ?? '',
          value: line.allocationInputMode === 'percent' ? '100' : minorToInput(lineNetTax(line)[0]),
        }],
      };
    }
    if (line.allocations.length > 0) return { ...line, allocationKind };
    return {
      ...line,
      allocationKind,
      allocations: [{ costCenterId: '', value: line.allocationInputMode === 'percent' ? '100' : '' }],
    };
  }));
  const addAllocation = (key: string) => setLines((ls) => ls.map((line) =>
    line.key === key ? { ...line, allocationKind: 'multiple', allocations: [...line.allocations, { costCenterId: '', value: '' }] } : line
  ));
  const removeAllocation = (key: string, allocationIndex: number) => setLines((ls) => ls.map((line) => {
    if (line.key !== key) return line;
    const allocations = line.allocations.filter((_, index) => index !== allocationIndex);
    return allocations.length === 0
      ? { ...line, allocationKind: 'none', allocations }
      : { ...line, allocationKind: allocations.length === 1 ? 'single' : 'multiple', allocations };
  }));
  const patchAllocation = (key: string, allocationIndex: number, patch: Partial<LineAllocation>) => setLines((ls) => ls.map((line) =>
    line.key === key
      ? { ...line, allocations: line.allocations.map((allocation, index) => index === allocationIndex ? { ...allocation, ...patch } : allocation) }
      : line
  ));

  // البحث يشمل الاسم والهاتف والرقم الضريبي للطرف، والاسم والرمز والباركود
  // للمنتج — يُدخل المستخدم ما بين يديه لا ما نفترض أنه يحفظه.
  const partnerOptions = useMemo<ComboOption[]>(
    () => partners.map((p) => ({
      value: p.id, label: p.name,
      // `Combobox` يبحث في `label` و`sub` و`hint` معاً، فما يوضع هنا يصير قابلاً
      // للبحث: الرمز ثم الرقم الضريبي — كلاهما في حمولة `PartnerResource` أصلاً.
      sub: [p.code, p.vat_number].filter(Boolean).join('  ·  ') || undefined,
      hint: p.phone ?? undefined,
    })),
    [partners]
  );

  const productOptions = useMemo<ComboOption[]>(
    () => products.map((p) => ({
      value: p.id,
      label: p.name,
      sub: [p.sku, p.barcode].filter(Boolean).join('  ·  ') || undefined,
      // الرصيد للمتابَع مخزونياً وحده — وهو ما يهمّ البائع قبل أن يَعِد بالتسليم.
      hint: p.track_inventory ? `${t('balance')} ${p.quantity_on_hand ?? 0}` : undefined,
    })),
    [products, t]
  );

  async function resolvePriceListPrice(productId: string, unitName = '', listId = priceListId): Promise<string | null> {
    if (!listId) return null;
    const query = new URLSearchParams({ product_id: productId });
    if (unitName) query.set('unit_name', unitName);
    try {
      const result = await api<{ data: PriceListResolution }>(`/price-lists/${listId}/resolve?${query.toString()}`);
      return result.data.matched ? result.data.price : null;
    } catch {
      return null;
    }
  }

  async function pickProduct(key: string, productId: string) {
    const p = products.find((x) => x.id === productId);
    if (!p) { setLine(key, { productId: null }); return; }
    // تبديل المنتج يُصفّر الوحدة: وحدة المنتج السابق قد لا تكون معرَّفة في
    // قالب الجديد، وإرسالها كان يُرفض بـ 422 بلا سبب ظاهر للمستخدم. يبدأ
    // بالسعر الأساسي ثم تستبدله القائمة المختارة، إن كان لها عنصر مطابق.
    setLine(key, { productId: p.id, description: p.name, price: p.sale_price, tax: String(p.tax_rate), unit: '' });
    const suggested = await resolvePriceListPrice(p.id);
    if (suggested !== null) setLines((current) => current.map((line) =>
      line.key === key && line.productId === p.id && line.unit === '' ? { ...line, price: suggested } : line
    ));
  }

  async function changeLineUnit(key: string, unit: string) {
    const line = lines.find((candidate) => candidate.key === key);
    setLine(key, { unit });
    if (!line?.productId) return;
    const suggested = await resolvePriceListPrice(line.productId, unit);
    if (suggested !== null) setLines((current) => current.map((candidate) =>
      candidate.key === key && candidate.productId === line.productId && candidate.unit === unit ? { ...candidate, price: suggested } : candidate
    ));
  }

  async function applyPriceListToLines() {
    if (!priceListId || applyingPriceList) return;
    setApplyingPriceList(true);
    try {
      const resolutions = await Promise.all(lines.map(async (line) => ({
        key: line.key,
        price: line.productId ? await resolvePriceListPrice(line.productId, line.unit, priceListId) : null,
      })));
      const prices = new Map(resolutions.filter((result) => result.price !== null).map((result) => [result.key, result.price as string]));
      setLines((current) => current.map((line) => prices.has(line.key) ? { ...line, price: prices.get(line.key) ?? line.price } : line));
    } finally {
      setApplyingPriceList(false);
    }
  }

  // معاينة الإجماليات (هللات) — بلا float. مطابق للـ backend.
  // في وضع «متضمَّن» تُستخرَج الضريبة من السعر؛ وإلا تُضاف فوقه.
  const extractTax = (incl: number, rate: number) =>
    rate <= 0 || incl <= 0 ? 0 : Math.round((incl * rate) / (100 + rate));
  // [الصافي، الضريبة] لكل سطر بعد خصمه.
  const lineNetTax = (l: Line): [number, number] => {
    const gross = (Number(l.qty) || 0) * riyalToMinor(l.price);
    const discounted = gross - Math.min(riyalToMinor(l.disc), gross);
    const rate = Number(l.tax) || 0;
    return taxInclusive
      ? [discounted - extractTax(discounted, rate), extractTax(discounted, rate)]
      : [discounted, Math.round((discounted * rate) / 100)];
  };
  const subMinor = lines.reduce((s, l) => s + lineNetTax(l)[0], 0);
  const taxGrossMinor = lines.reduce((s, l) => s + lineNetTax(l)[1], 0);
  const rawDiscount = discountMode === 'percent'
    ? Math.floor((subMinor * (Number(discountInput) || 0)) / 100)
    : riyalToMinor(discountInput);
  const discountMinor = Math.max(0, Math.min(rawDiscount, subMinor));
  const netMinor = subMinor - discountMinor;
  const goodsTaxMinor = subMinor > 0 ? Math.floor((taxGrossMinor * netMinor) / subMinor) : 0;
  const shippingMinor = Math.max(0, riyalToMinor(shippingInput));
  const shippingTaxMinor = Math.round((shippingMinor * 15) / 100);
  const taxMinor = goodsTaxMinor + shippingTaxMinor;
  const adjustmentMinor = riyalToMinor(adjustmentInput);
  const totalMinor = netMinor + shippingMinor + taxMinor + adjustmentMinor;

  const minorToInput = (minor: number): string => `${Math.floor(minor / 100)}.${String(Math.abs(minor % 100)).padStart(2, '0')}`;
  const allocationMinorTotal = (line: Line): number | null => {
    if (line.allocationKind === 'none') return 0;
    if (line.allocationInputMode === 'percent') {
      const values = line.allocations.map((allocation) => percentToBasisPoints(allocation.value));
      if (values.some((value) => value === null)) return null;
      return values.reduce<number>((sum, value) => sum + (value ?? 0), 0);
    }
    const values = line.allocations.map((allocation) => riyalToMinor(allocation.value));
    if (values.some((value) => !Number.isFinite(value))) return null;
    return values.reduce((sum, value) => sum + value, 0);
  };
  const allocationError = (line: Line): string | null => {
    if (line.allocationKind === 'none') return null;
    if (line.allocations.length === 0 || line.allocations.some((allocation) => !allocation.costCenterId)) return t('allocation_need_center');
    const ids = line.allocations.map((allocation) => allocation.costCenterId);
    if (new Set(ids).size !== ids.length) return t('allocation_duplicate_center');
    const total = allocationMinorTotal(line);
    if (total === null || line.allocations.some((allocation) => !allocation.value.trim())) return t('allocation_invalid_value');
    return line.allocationInputMode === 'percent'
      ? (total === 10000 ? null : t('allocation_percent_invalid'))
      : (total === lineNetTax(line)[0] ? null : t('allocation_amount_invalid'));
  };
  const changeAllocationInputMode = (key: string, allocationInputMode: AllocationInputMode) => setLines((ls) => ls.map((line) => {
    if (line.key !== key || line.allocationInputMode === allocationInputMode) return line;
    const lineNet = lineNetTax(line)[0];
    if (lineNet <= 0) return { ...line, allocationInputMode };
    const converted = line.allocations.map((allocation, index) => {
      if (allocationInputMode === 'amount') {
        const basisPoints = percentToBasisPoints(allocation.value) ?? 0;
        const previousAmount = line.allocations.slice(0, index).reduce(
          (sum, item) => sum + Math.floor(lineNet * (percentToBasisPoints(item.value) ?? 0) / 10000),
          0
        );
        const minor = index === line.allocations.length - 1
          ? lineNet - previousAmount
          : Math.floor(lineNet * basisPoints / 10000);
        return { ...allocation, value: minorToInput(minor) };
      }
      const minor = riyalToMinor(allocation.value);
      const previousBasis = line.allocations.slice(0, index).reduce((sum, item) => {
        const previousMinor = riyalToMinor(item.value);
        return sum + Math.floor((Number.isFinite(previousMinor) ? previousMinor : 0) * 10000 / lineNet);
      }, 0);
      const basisPoints = index === line.allocations.length - 1
        ? 10000 - previousBasis
        : Math.floor((Number.isFinite(minor) ? minor : 0) * 10000 / lineNet);
      return { ...allocation, value: basisPointsToPercent(basisPoints) };
    });
    return { ...line, allocationInputMode, allocations: converted };
  }));

  /**
   * الحدّ الأدنى للسعر — مرآةٌ للشرط في `InvoiceService`: يُقارَن **صافي السطر**
   * بـ`min × quantity × unitFactor`. غرضُها إبرازُ القاعدة عند الحاجة لا فرضُها؛
   * الفرض في الخادم وحده (ويشترط فوقه صلاحية `sales.minimum_price_override`).
   *
   * ولذلك لا يُخفى حقل السبب أبداً حين تكون النتيجة سالبة: الواجهة لا ترى إعداد
   * `sales.enforce_min_sale_price`، فحسابٌ محلّي مخالف كان سيترك المستخدم أمام
   * رفضٍ من الخادم بلا حقلٍ يملؤه.
   */
  const lineMinimum = (line: Line): { minSalePrice: string | null; belowMinimum: boolean } => {
    const product = products.find((item) => item.id === line.productId);
    const minMinor = product?.min_sale_price ? riyalToMinor(product.min_sale_price) : 0;
    if (!product?.min_sale_price || !Number.isFinite(minMinor) || minMinor <= 0) {
      return { minSalePrice: null, belowMinimum: false };
    }
    const quantity = Number(line.qty) || 0;
    const factor = product.units?.find((unit) => unit.name === line.unit)?.factor ?? 1;
    const threshold = minMinor * quantity * factor;
    return {
      minSalePrice: product.min_sale_price,
      belowMinimum: quantity > 0 && riyalToMinor(line.price) > 0 && lineNetTax(line)[0] < threshold,
    };
  };

  // سطرٌ كُتب فيه شيءٌ وكميتُه فارغة يُسقطه `submit` من الحمولة بلا خبر — أي
  // يحذف بنداً كتبه المستخدم. المنع هنا يجعل ذلك الحذف الصامت مستحيلاً.
  const missingQty = lines.some((line) => !isUntouchedLine(line) && !hasValidQty(line));

  const canSave = useMemo(
    () => !!partnerId && !saving && !loadingDoc && !missingQty && !lines.some((line) => allocationError(line)),
    [partnerId, saving, loadingDoc, missingQty, lines, taxInclusive, t]
  );

  async function submit(post: boolean) {
    if (lines.some((l) => l.price !== '' && !Number.isFinite(riyalToMinor(l.price)))) {
      setError(tc('saveFailed'));
      return;
    }
    const invalidAllocation = lines.map(allocationError).find(Boolean);
    if (invalidAllocation) {
      setError(invalidAllocation);
      return;
    }
    const items = lines
      .filter((l) => (Number(l.qty) || 0) > 0 && riyalToMinor(l.price) > 0)
      .map((l) => {
        const qty = Math.floor(Number(l.qty));
        const gross = qty * riyalToMinor(l.price);
        const allocations = l.allocationKind === 'none' ? undefined : l.allocations.map((allocation) => ({
          cost_center_id: allocation.costCenterId,
          mode: l.allocationInputMode,
          value: l.allocationInputMode === 'percent'
            ? percentToBasisPoints(allocation.value) ?? 0
            : riyalToMinor(allocation.value),
        }));
        return {
          product_id: l.productId,
          description: l.description || null,
          quantity: qty,
          unit: l.unit || null,
          unit_price: riyalToMinor(l.price),
          tax_rate: Number(l.tax) || 0,
          discount: Math.min(Number.isFinite(riyalToMinor(l.disc)) ? riyalToMinor(l.disc) : 0, gross),
          ...(l.minimumPriceOverrideReason.trim() ? { minimum_price_override_reason: l.minimumPriceOverrideReason.trim() } : {}),
          ...(allocations ? { cost_center_allocations: allocations } : {}),
        };
      });
    if (items.length === 0) { setError(t('need_line')); return; }
    setSaving(true);
    setError(null);
    // نوع الدفع (نقدي/آجل) لم يعد يُرسَل من هذه الشاشة: غيابه يعني «اتبع تفضيل
    // المستأجر» عند الإنشاء و«أبقِ القيمة» عند التعديل. والسداد يُعبَّر عنه
    // بخانة «مدفوع بالفعل» وحدها — يترجمها الخادم إلى سند قبض مرحَّل.
    // وتفاصيل الدفع **مشروطة بالخانة**: بلا تأشير لا تُرسَل، فلا تُسجَّل
    // خزينةٌ ولا مرجعٌ لفاتورة لم يُعلَن تحصيلها.
    const body = {
      partner_id: partnerId, warehouse_id: warehouseId || null, price_list_id: priceListId || null, invoice_date: date || null, due_date: dueDate || null,
      cost_center_id: centerId || null, salesperson_id: salespersonId || null,
      discount: discountMinor, shipping: shippingMinor, adjustment: adjustmentMinor,
      tax_inclusive: taxInclusive, zatca_document_type: zatcaDocumentType, notes: notes || null, items,
      is_paid: isPaid,
      payment_method: isPaid ? payMethod : null,
      payment_reference: isPaid ? payReference || null : null,
      cash_account_id: isPaid ? cashAccountId || null : null,
    };
    try {
      const id = editId
        ? (await api<{ data: { id: string } }>(`/invoices/${editId}`, { method: 'PUT', body })).data.id
        : (await api<{ data: { id: string } }>('/invoices', { method: 'POST', body })).data.id;
      if (post) await api(`/invoices/${id}/post`, { method: 'POST' });
      success(editId ? tc('updated') : tc('created'));
      router.push(`/invoices/${id}`);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
      setSaving(false);
    }
  }

  const dialogs = (
    <>
      <PartnerDialog
        open={newPartner}
        onClose={() => setNewPartner(false)}
        onSaved={() => { setNewPartner(false); loadPartners(); }}
        defaultType="customer"
        addTitle={t('new_partner_title')}
      />

      {/* المنتج المُنشأ يُختار في سطره فوراً — وإلا أعاد المستخدم البحث عمّا
          أنشأه للتوّ. الاختيار بعد إعادة الجلب لا قبلها. */}
      <ProductDialog
        open={newProductFor !== null}
        onClose={() => setNewProductFor(null)}
        onSaved={async () => {
          const key = newProductFor;
          setNewProductFor(null);
          const before = new Set(products.map((p) => p.id));
          const fresh = await api<{ data: Product[] }>('/products').catch(() => null);
          if (!fresh) { loadProducts(); return; }
          const active = fresh.data.filter((p) => p.is_active);
          setProducts(active);
          const created = active.find((p) => !before.has(p.id));
          if (key && created) {
            setLine(key, {
              productId: created.id, description: created.name,
              price: created.sale_price, tax: String(created.tax_rate), unit: '',
            });
          }
        }}
      />
    </>
  );

  const summaryRow = (label: string, value: string, tone?: 'positive' | 'muted') => (
    <div className="flex items-baseline justify-between gap-3 text-sm">
      <span className="text-muted">{label}</span>
      <span className={cn('num text-end', tone === 'positive' ? 'text-positive' : 'text-text')}>{value}</span>
    </div>
  );

  return (
    <FormPage
      width="full"
      backHref="/invoices"
      backLabel={t('back')}
      title={editId ? t('edit_title') : t('new_title')}
      actions={
        <FormActions
          secondary={<>
            <Button asChild type="button" variant="ghost"><Link href='/invoices'>{t('cancel')}</Link></Button>
            <Button type="button" variant="outline" disabled={!canSave} onClick={() => submit(false)}>{t('save_draft')}</Button>
          </>}
          primary={<Button type="button" disabled={!canSave} onClick={() => submit(true)}>{t('save_post')}</Button>}
        />
      }
    >
      {dialogs}

      {!editId && <section className="flex flex-col gap-3 rounded border border-primary/25 bg-primary-soft/40 p-4 sm:flex-row sm:items-center sm:justify-between"><div><h2 className="font-medium text-text">{td('invoiceDraftAction')}</h2><p className="mt-1 text-sm text-muted">{td('invoiceDraftBoundaryHint')}</p></div><Button asChild variant="outline" className="shrink-0"><Link href="/delivery-notes/invoice-draft"><FileText className="h-4 w-4" strokeWidth={1.7} />{td('invoiceDraftAction')}</Link></Button></section>}

      {/* ═══ ١. العميل وهويّة الفاتورة ═══
          العميل أولاً لأنه يقرّر قائمة الأسعار وشروط السداد، ثم ما يعرّف المستند. */}
      <FormSection title={t('customer_section')} icon={Users}>
        <FieldGrid columns={3}>
          <FieldSpan className="space-y-1.5 lg:col-span-2">
            <Label htmlFor="partner">{t('partner')} <span className="text-negative">*</span></Label>
            <div className="flex items-center gap-2">
              <Combobox
                id="partner"
                className="min-w-0 flex-1"
                value={partnerId}
                onChange={selectPartner}
                options={partnerOptions}
                placeholder={t('choose_partner')}
                searchPlaceholder={t('search_partner')}
                emptyText={t('no_partner_found')}
              />
              <Button type="button" variant="outline" className="shrink-0" onClick={() => setNewPartner(true)}>
                <Plus className="h-4 w-4" strokeWidth={1.7} />
                <span className="hidden sm:inline">{t('new_partner')}</span>
              </Button>
            </div>
          </FieldSpan>
          {!editId && <NumberPreviewField id="invoice-number" label={t('invoice_number')} number={suggestedNumber} loading={loadingNumber} />}
          <div className="space-y-1.5">
            <Label htmlFor="date">{t('invoice_date')}</Label>
            <Input id="date" type="date" dir="ltr" value={date} onChange={(e) => changeDate(e.target.value)} />
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="zatca-document-type">{t('zatca_document_type')}</Label>
            <Select
              id="zatca-document-type"
              value={zatcaDocumentType ?? ''}
              onChange={(e) => setZatcaDocumentType(e.target.value as 'standard' | 'simplified')}
            >
              <option value="" disabled>{t('zatca_document_type_pending')}</option>
              <option value="standard">{t('zatca_standard')}</option>
              <option value="simplified">{t('zatca_simplified')}</option>
            </Select>
            <p className="text-xs text-muted">{t('zatca_document_type_hint')}</p>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="terms">{t('payment_terms')}</Label>
            <div className="relative">
              <Input id="terms" type="number" min={0} dir="ltr" className="num pe-14" value={terms} onChange={(e) => applyTerms(e.target.value)} />
              <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-xs text-muted">{t('days')}</span>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="due">{t('due_date')}</Label>
            <Input id="due" type="date" dir="ltr" value={dueDate} onChange={(e) => setDueDate(e.target.value)} />
          </div>
        </FieldGrid>
      </FormSection>

      {/* ═══ ٢. البنود — منطقة العمل الأولى ═══ */}
      <FormSection
        title={t('items_section')}
        icon={ShoppingCart}
        action={
          <Button type="button" variant="outline" size="sm" onClick={addLine}>
            <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />{t('add_line')}
          </Button>
        }
        contentClassName="space-y-2"
      >
        {/* رأس الأعمدة للصفّ الكثيف وحده — دونه لكل حقلٍ تسميتُه. */}
        <div className={cn('hidden gap-2 px-1 text-[11px] font-medium text-muted lg:grid', LINE_GRID)}>
          <div>{t('item')}</div>
          <div>{t('description')}</div>
          <div className="text-end">{t('price')}</div>
          <div className="text-end">{t('qty')}</div>
          <div className="text-end">{t('line_discount_short')}</div>
          <div className="text-end">{t('tax')}</div>
          <div className="text-end">{t('total_with_vat')}</div>
          <div />
        </div>

        {lines.map((l) => {
          const [net, lineTax] = lineNetTax(l);
          const { minSalePrice, belowMinimum } = lineMinimum(l);
          return (
            <InvoiceLineRow
              key={l.key}
              line={l}
              productOptions={productOptions}
              units={products.find((p) => p.id === l.productId)?.units ?? []}
              centers={centers}
              net={net}
              lineTax={lineTax}
              minSalePrice={minSalePrice}
              belowMinimum={belowMinimum}
              allocationTotal={allocationMinorTotal(l)}
              allocationIssue={allocationError(l)}
              canRemove={lines.length > 1}
              onPatch={(patch) => setLine(l.key, patch)}
              onPickProduct={(productId) => void pickProduct(l.key, productId)}
              onChangeUnit={(unit) => void changeLineUnit(l.key, unit)}
              onNewProduct={() => setNewProductFor(l.key)}
              onRemove={() => removeLine(l.key)}
              onAllocationKind={(kind) => setAllocationKind(l.key, kind)}
              onAllocationInputMode={(mode) => changeAllocationInputMode(l.key, mode)}
              onAllocationPatch={(index, patch) => patchAllocation(l.key, index, patch)}
              onAllocationAdd={() => addAllocation(l.key)}
              onAllocationRemove={(index) => removeAllocation(l.key, index)}
            />
          );
        })}

        <p className="pt-1 text-xs leading-relaxed text-muted">{t('items_hint')}</p>
        {missingQty && (
          <p className="rounded border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
            {t('qty_required')}
          </p>
        )}
      </FormSection>

      {/* ═══ ٣. التسويات التجارية ═══ */}
      <FormSection title={t('discount_shipping')} icon={Tag}>
        <FieldGrid columns={3}>
          <div className="space-y-1.5">
            <Label htmlFor="taxmode">{t('tax_mode')}</Label>
            <Select id="taxmode" value={taxInclusive ? '1' : '0'} onChange={(e) => setTaxInclusive(e.target.value === '1')}>
              <option value="0">{t('tax_exclusive')}</option>
              <option value="1">{t('tax_inclusive')}</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dmode">{t('discount_mode')}</Label>
            <Select id="dmode" value={discountMode} onChange={(e) => setDiscountMode(e.target.value as 'amount' | 'percent')}>
              <option value="amount">{t('discount_amount')}</option>
              <option value="percent">{t('discount_percent')}</option>
            </Select>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="dval">{discountMode === 'percent' ? t('discount_percent') : t('discount_amount')}</Label>
            <div className="relative">
              <Input id="dval" inputMode="decimal" dir="ltr" className="num pe-12 text-end" placeholder="0" value={discountInput} onChange={(e) => setDiscountInput(e.target.value)} />
              <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-xs text-muted" aria-hidden="true">{discountMode === 'percent' ? '%' : SAUDI_RIYAL_SYMBOL}</span>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="ship">{t('shipping')}</Label>
            <div className="relative">
              <Input id="ship" inputMode="decimal" dir="ltr" className="num pe-12 text-end" placeholder="0" value={shippingInput} onChange={(e) => setShippingInput(e.target.value)} />
              <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-xs text-muted" aria-hidden="true">{SAUDI_RIYAL_SYMBOL}</span>
            </div>
          </div>
          <div className="space-y-1.5">
            <Label htmlFor="adj">{t('adjustment')}</Label>
            <div className="relative">
              <Input id="adj" inputMode="decimal" dir="ltr" className="num pe-12 text-end" placeholder="0" value={adjustmentInput} onChange={(e) => setAdjustmentInput(e.target.value)} />
              <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-xs text-muted" aria-hidden="true">{SAUDI_RIYAL_SYMBOL}</span>
            </div>
            <p className="text-[11px] leading-relaxed text-muted">{t('adjustment_hint')}</p>
          </div>
        </FieldGrid>
      </FormSection>

      {/* ═══ ٤. الإجماليات ═══
          في تدفّق القراءة تحت التسويات التي تصنعها مباشرة، لا في عمودٍ جانبي:
          العمود الجانبي كان يقتطع من عرض البنود — وهي منطقة العمل الأولى — نحو
          ٣٠٠px عند كل مقاس، فيضيق صفّها الكثيف حتى تُقصّ أرقامه. */}
      <Card>
        <CardContent className="grid gap-x-8 gap-y-2 p-4 sm:grid-cols-2">
          <div className="space-y-2">
            {summaryRow(t('subtotal'), formatRiyal(subMinor / 100))}
            {discountMinor > 0 && summaryRow(t('discount'), `-${formatRiyal(discountMinor / 100)}`, 'positive')}
            {shippingMinor > 0 && summaryRow(t('shipping'), formatRiyal(shippingMinor / 100))}
            {summaryRow(t('tax_total'), formatRiyal(taxMinor / 100))}
            {adjustmentMinor !== 0 && summaryRow(t('adjustment'), `${adjustmentMinor > 0 ? '+' : ''}${formatRiyal(adjustmentMinor / 100)}`)}
          </div>
          <div className="flex flex-col justify-end gap-1 border-t border-border pt-3 sm:border-0 sm:pt-0">
            <div className="flex items-baseline justify-between gap-3">
              <span className="font-semibold text-text">{t('total')}</span>
              <span className="num text-2xl font-bold text-primary-hover">{formatRiyal(totalMinor / 100)}</span>
            </div>
            <p className="text-[11px] leading-relaxed text-muted">{t('summary_hint')}</p>
          </div>
        </CardContent>
      </Card>

      {/* ═══ ٥. السداد — الخانة هي البوّابة ═══ */}
      <FormSection title={t('payment_section')} icon={Wallet}>
        <label className="flex cursor-pointer items-center gap-2 py-0.5 text-sm font-medium text-text">
          <input
            type="checkbox"
            className="h-4 w-4 shrink-0 accent-primary"
            checked={isPaid}
            onChange={(e) => setIsPaid(e.target.checked)}
          />
          {t('paid_already')}
        </label>

        {/* **إخفاء بصري لا إزالة**: الحقول تبقى في الـDOM وقيمها في الحالة، فإلغاء
            الخانة لا يُفقد ما أُدخل، وإعادة التأشير تُظهره كما تُرك. و`invisible`
            ضرورية فوق قصّ الارتفاع: المقصوص وحده يبقى في شجرة الوصولية وقابلاً
            للتركيز، فيُملى على المستخدم حقلٌ لا يراه. */}
        <div className={cn('grid transition-[grid-template-rows] duration-150 ease-out', isPaid ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]')}>
          <div className={cn('overflow-hidden', !isPaid && 'invisible')}>
            <div className="pt-3" aria-hidden={!isPaid}>
              <FieldGrid columns={3}>
                <div className="space-y-1.5">
                  <Label htmlFor="pay-method">{t('payment_method')}</Label>
                  <Select id="pay-method" value={payMethod} tabIndex={isPaid ? undefined : -1} onChange={(e) => setPayMethod(e.target.value)}>
                    <option value="cash">{t('method_cash')}</option>
                    <option value="transfer">{t('method_transfer')}</option>
                    <option value="card">{t('method_card')}</option>
                  </Select>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pay-ref">{t('payment_reference')}</Label>
                  <Input id="pay-ref" dir="ltr" className="num" value={payReference} tabIndex={isPaid ? undefined : -1} onChange={(e) => setPayReference(e.target.value)} />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="pay-account">{t('cash_account')}</Label>
                  <Select id="pay-account" value={cashAccountId} tabIndex={isPaid ? undefined : -1} onChange={(e) => setCashAccountId(e.target.value)}>
                    {/* الافتراضية = خزينة الأداة (1110 للنقد، 1120 للتحويل/البطاقة). */}
                    <option value="">{t('cash_account_main')}</option>
                    {cashAccounts.map((a) => (
                      <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                    ))}
                  </Select>
                </div>
              </FieldGrid>
            </div>
          </div>
        </div>
      </FormSection>

      {/* ═══ ٦. بيانات تشغيلية ومحاسبية ثانوية ═══
          تحت البنود لا فوقها: كانت سبعة حقولٍ تفصل المحاسب عن منطقة عمله. */}
      {(warehouses.length > 0 || priceLists.length > 0 || centers.length > 0 || employees.length > 0) && (
        <FormSection title={t('meta_section')} icon={FileText}>
          <FieldGrid columns={3}>
            {warehouses.length > 0 && (
              <div className="space-y-1.5">
                <Label htmlFor="warehouse">{t('warehouse')}</Label>
                <Select id="warehouse" value={warehouseId} onChange={(e) => setWarehouseId(e.target.value)}>
                  <option value="">{t('warehouse_auto')}</option>
                  {warehouses.map((warehouse) => (
                    <option key={warehouse.id} value={warehouse.id}>{warehouse.code} — {warehouse.name}</option>
                  ))}
                </Select>
                <p className="text-xs text-muted">{t('warehouse_hint')}</p>
              </div>
            )}
            {priceLists.length > 0 && (
              <div className="space-y-1.5">
                <Label htmlFor="price-list">{t('price_list')}</Label>
                <div className="flex gap-2">
                  <Select id="price-list" className="min-w-0 flex-1" value={priceListId} onChange={(e) => setPriceListId(e.target.value)}>
                    <option value="">{t('price_list_base')}</option>
                    {priceLists.map((list) => <option key={list.id} value={list.id} disabled={!list.is_active && list.id !== priceListId}>{list.name}{!list.is_active ? ` — ${t('price_list_inactive')}` : ''}</option>)}
                  </Select>
                  <Button type="button" variant="outline" size="sm" className="shrink-0" disabled={!priceListId || !priceLists.find((list) => list.id === priceListId)?.is_active || applyingPriceList} onClick={() => void applyPriceListToLines()}>{applyingPriceList ? t('price_list_applying') : t('price_list_apply')}</Button>
                </div>
                <p className="text-xs text-muted">{t('price_list_hint')}</p>
              </div>
            )}
            {centers.length > 0 && (
              <div className="space-y-1.5">
                <Label htmlFor="center">{t('cost_center')}</Label>
                <Select id="center" value={centerId} onChange={(e) => setCenterId(e.target.value)}>
                  <option value="">{t('no_center')}</option>
                  {centers.map((c) => (<option key={c.id} value={c.id}>{c.code} — {c.name}</option>))}
                </Select>
              </div>
            )}
            {employees.length > 0 && (
              <div className="space-y-1.5">
                <Label htmlFor="sp">{t('salesperson')}</Label>
                <Select id="sp" value={salespersonId} onChange={(e) => setSalespersonId(e.target.value)}>
                  <option value="">{t('no_salesperson')}</option>
                  {employees.map((e2) => (<option key={e2.id} value={e2.id}>{e2.name}</option>))}
                </Select>
              </div>
            )}
          </FieldGrid>
        </FormSection>
      )}

      {/* ═══ ٧. الملاحظات ═══ */}
      <FormSection title={t('notes')} icon={StickyNote}>
        <textarea
          value={notes}
          onChange={(e) => setNotes(e.target.value)}
          rows={3}
          className="min-h-20 w-full resize-y rounded border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
          placeholder={t('notes')}
        />
      </FormSection>

      {error && <FormAlert>{error}</FormAlert>}
    </FormPage>
  );
}
