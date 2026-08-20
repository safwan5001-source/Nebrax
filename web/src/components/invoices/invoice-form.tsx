'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight, Plus, Trash2, FileText, Users, ShoppingCart, StickyNote, Tag } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Combobox, type ComboOption } from '@/components/ui/combobox';
import { PartnerDialog } from '@/components/partners/partner-dialog';
import { ProductDialog } from '@/components/products/product-dialog';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { cn } from '@/lib/utils';
import { formatRiyal, riyalToMinor } from '@/lib/money';

interface Partner { id: string; name: string; type?: string; phone?: string | null; vat_number?: string | null }
interface ProductUnit { name: string; factor: number }
interface Product {
  id: string; name: string; sku?: string | null; barcode?: string | null;
  sale_price: string; tax_rate: number; is_active: boolean;
  track_inventory?: boolean; quantity_on_hand?: number; units?: ProductUnit[];
}
interface CostCenter { id: string; code: string; name: string; is_active: boolean }
interface Employee { id: string; name: string }
interface Account { id: string; code: string; name: string; type: string; is_group: boolean }
type AllocationKind = 'none' | 'single' | 'multiple';
type AllocationInputMode = 'percent' | 'amount';
interface LineAllocation { costCenterId: string; value: string }
interface Line {
  key: string; productId: string | null; description: string; qty: string; price: string; tax: string; disc: string; unit: string;
  allocationKind: AllocationKind; allocationInputMode: AllocationInputMode; allocations: LineAllocation[];
}
interface ApiLineAllocation { cost_center_id: string; mode: AllocationInputMode; basis_points: number; amount: string }
interface ApiLine {
  product_id: string | null; description: string | null; quantity: number; unit_name: string | null; unit_price: string; tax_rate: number; line_discount: string;
  cost_center_allocations?: ApiLineAllocation[];
}
interface ApiInvoice {
  status: string; partner_id: string; payment_type: string; invoice_date: string; due_date: string | null;
  cost_center_id: string | null; salesperson_id: string | null; discount: string; shipping: string;
  adjustment: string; tax_inclusive: boolean; notes: string | null; lines: ApiLine[];
  is_paid?: boolean; payment_method?: string | null; payment_reference?: string | null; cash_account_id?: string | null;
}
interface TaxDef { name: string; rate: number; inclusive: boolean }

let lineSeq = 0;
const newLine = (): Line => ({
  key: `l${++lineSeq}`, productId: null, description: '', qty: '1', price: '', tax: '15', disc: '', unit: '',
  allocationKind: 'none', allocationInputMode: 'percent', allocations: [],
});

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
  const tc = useTranslations('common');
  const router = useRouter();
  const { success } = useToast();

  const [partners, setPartners] = useState<Partner[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [centers, setCenters] = useState<CostCenter[]>([]);
  const [employees, setEmployees] = useState<Employee[]>([]);
  const [cashAccounts, setCashAccounts] = useState<Account[]>([]);
  const [partnerId, setPartnerId] = useState('');
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
  const [loadingDoc, setLoadingDoc] = useState(!!editId);
  const [newPartner, setNewPartner] = useState(false);
  // السطر الذي فُتحت من منتقيه نافذة «منتج جديد» — ليُختار فيه فور الحفظ.
  const [newProductFor, setNewProductFor] = useState<string | null>(null);

  const loadPartners = useCallback(
    (selectFirst = false) =>
      api<{ data: Partner[] }>('/partners')
        .then((r) => {
          setPartners(r.data);
          if (selectFirst && r.data[0]) setPartnerId((p) => p || r.data[0].id);
        })
        .catch(() => {}),
    []
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
    api<{ data: Employee[] }>('/employees').then((r) => setEmployees(r.data)).catch(() => {});
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
      sub: p.vat_number ?? undefined,
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

  function pickProduct(key: string, productId: string) {
    const p = products.find((x) => x.id === productId);
    if (!p) { setLine(key, { productId: null }); return; }
    // تبديل المنتج يُصفّر الوحدة: وحدة المنتج السابق قد لا تكون معرَّفة في
    // قالب الجديد، وإرسالها كان يُرفض بـ 422 بلا سبب ظاهر للمستخدم.
    setLine(key, { productId: p.id, description: p.name, price: p.sale_price, tax: String(p.tax_rate), unit: '' });
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

  const canSave = useMemo(
    () => !!partnerId && !saving && !loadingDoc && !lines.some((line) => allocationError(line)),
    [partnerId, saving, loadingDoc, lines, taxInclusive, t]
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
      partner_id: partnerId, invoice_date: date || null, due_date: dueDate || null,
      cost_center_id: centerId || null, salesperson_id: salespersonId || null,
      discount: discountMinor, shipping: shippingMinor, adjustment: adjustmentMinor,
      tax_inclusive: taxInclusive, notes: notes || null, items,
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

  return (
    <div className="space-y-5">
      {dialogs}
      {/* شريط الإجراءات */}
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.push('/invoices')} aria-label={t('back')}>
          <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
        </Button>
        <h1 className="text-xl font-semibold text-text">{editId ? t('edit_title') : t('new_title')}</h1>
        <div className="ms-auto flex items-center gap-2">
          <Button variant="ghost" onClick={() => router.push('/invoices')}>{t('cancel')}</Button>
          <Button variant="outline" disabled={!canSave} onClick={() => submit(false)}>{t('save_draft')}</Button>
          <Button disabled={!canSave} onClick={() => submit(true)}>{t('save_post')}</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-[1fr_300px]">
        {/* العمود الرئيسي */}
        <div className="min-w-0 space-y-5">
          {/* العميل — بلا «نوع الدفع»: السداد صار خانةً واحدة في ملخّص الفاتورة
              أسفل الإجمالي، حيث يُقرَّر فعلاً. */}
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Users className="h-4 w-4 text-primary" strokeWidth={1.8} />{t('customer_section')}</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="partner">{t('partner')} <span className="text-negative">*</span></Label>
                  <div className="flex items-center gap-2">
                    <Combobox
                      id="partner"
                      className="min-w-0 flex-1"
                      value={partnerId}
                      onChange={setPartnerId}
                      options={partnerOptions}
                      placeholder={t('choose_partner')}
                      searchPlaceholder={t('search_partner')}
                      emptyText={t('no_partner_found')}
                    />
                    <Button type="button" variant="outline" onClick={() => setNewPartner(true)}>
                      <Plus className="h-4 w-4" strokeWidth={1.7} />
                      {t('new_partner')}
                    </Button>
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* بيانات الفاتورة */}
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><FileText className="h-4 w-4 text-primary" strokeWidth={1.8} />{t('meta_section')}</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                <div className="space-y-1.5">
                  <Label>{t('invoice_number')}</Label>
                  <div className="flex h-9 items-center rounded border border-border bg-background px-3 text-sm text-muted">{t('auto_number')}</div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="date">{t('invoice_date')}</Label>
                  <Input id="date" type="date" dir="ltr" value={date} onChange={(e) => changeDate(e.target.value)} />
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
              </div>
            </CardContent>
          </Card>

          {/* البنود */}
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2"><ShoppingCart className="h-4 w-4 text-primary" strokeWidth={1.8} />{t('lines')}</CardTitle>
              <Button type="button" variant="outline" size="sm" onClick={addLine}>
                <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />{t('add_line')}
              </Button>
            </CardHeader>
            <CardContent className="space-y-2">
              <div className="hidden grid-cols-12 gap-2 px-1 text-[11px] font-medium text-muted md:grid">
                <div className="col-span-2">{t('item')}</div>
                <div className="col-span-2">{t('description')}</div>
                <div className="col-span-2 text-end">{t('price')}</div>
                <div className="col-span-2 text-end">{t('qty')}</div>
                <div className="col-span-1 text-end">{t('line_discount_short')}</div>
                <div className="col-span-1 text-end">{t('tax')}</div>
                <div className="col-span-1 text-end">{t('total_with_vat')}</div>
                <div className="col-span-1" />
              </div>

              {lines.map((l) => {
                const [net, lineTax] = lineNetTax(l);
                return (
                  <div key={l.key} className="grid grid-cols-2 items-center gap-2 rounded-lg border border-border p-2 md:grid-cols-12 md:border-0 md:p-0">
                    {/* **السطر الوصفي يبقى متاحاً هنا عمداً** — خلافاً لفاتورة
                        الشراء. بيعُ خدمةٍ خارج الكتالوج يُقيَّد إيراداً على 4110
                        كأي بيع، فلا خطأ محاسبياً يُبرّر الإلزام. */}
                    <Combobox
                      className="col-span-2 md:col-span-2"
                      value={l.productId ?? ''}
                      onChange={(v) => pickProduct(l.key, v)}
                      options={productOptions}
                      placeholder={t('manual')}
                      searchPlaceholder={t('search_product')}
                      emptyText={t('no_product_found')}
                      clearLabel={t('manual')}
                      footerLabel={t('new_product')}
                      onFooterClick={() => setNewProductFor(l.key)}
                      aria-label={t('item')}
                    />
                    <Input className="col-span-2 md:col-span-2" placeholder={t('description')} value={l.description} onChange={(e) => setLine(l.key, { description: e.target.value, productId: null })} />
                    <Input className="num text-end md:col-span-2" inputMode="decimal" placeholder={t('price')} value={l.price} onChange={(e) => setLine(l.key, { price: e.target.value })} />
                    {/* الكمية ووحدتها خلية واحدة: الوحدة تُعرَض فقط حين يحمل
                        المنتج قالباً بأكثر من وحدة، فلا تزدحم الشاشة بلا داعٍ. */}
                    <div className="col-span-2 flex items-center gap-1 md:col-span-2">
                      <Input className="num flex-1 text-end" type="number" min={1} value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value })} />
                      {(() => {
                        const units = products.find((p) => p.id === l.productId)?.units ?? [];
                        if (units.length < 2) return null;
                        return (
                          <Select className="w-24 shrink-0" value={l.unit} onChange={(e) => setLine(l.key, { unit: e.target.value })} aria-label={t('unit')}>
                            {units.map((u) => (<option key={u.name} value={u.factor === 1 ? '' : u.name}>{u.name}</option>))}
                          </Select>
                        );
                      })()}
                    </div>
                    <Input className="num text-end md:col-span-1" inputMode="decimal" placeholder="0" value={l.disc} onChange={(e) => setLine(l.key, { disc: e.target.value })} />
                    <Input className="num text-end md:col-span-1" type="number" min={0} max={100} value={l.tax} onChange={(e) => setLine(l.key, { tax: e.target.value })} />
                    <div className="num col-span-1 text-end text-sm text-text md:col-span-1">{formatRiyal((net + lineTax) / 100)}</div>
                    <Button type="button" variant="ghost" size="icon" className="col-span-1 ms-auto md:col-span-1" aria-label={t('remove_line')} onClick={() => removeLine(l.key)}>
                      <Trash2 className="h-4 w-4 text-negative" strokeWidth={1.7} />
                    </Button>

                    {centers.length > 0 && (() => {
                      const allocationTotal = allocationMinorTotal(l);
                      const allocationIssue = allocationError(l);
                      const lineNet = net;
                      const remaining = allocationTotal === null
                        ? null
                        : l.allocationInputMode === 'percent' ? 10000 - allocationTotal : lineNet - allocationTotal;
                      return (
                        <div className="col-span-2 rounded-md border border-border bg-surface/60 p-3 md:col-span-12">
                          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                            <div className="space-y-1.5">
                              <Label htmlFor={`line-center-kind-${l.key}`}>{t('line_cost_center')}</Label>
                              <Select
                                id={`line-center-kind-${l.key}`}
                                value={l.allocationKind}
                                onChange={(event) => setAllocationKind(l.key, event.target.value as AllocationKind)}
                              >
                                <option value="none">{t('line_cost_center_none')}</option>
                                <option value="single">{t('line_cost_center_single')}</option>
                                <option value="multiple">{t('line_cost_center_multiple')}</option>
                              </Select>
                            </div>
                            {l.allocationKind !== 'none' && (
                              <div className="space-y-1.5">
                                <Label htmlFor={`line-center-mode-${l.key}`}>{t('allocation_mode')}</Label>
                                <Select
                                  id={`line-center-mode-${l.key}`}
                                  value={l.allocationInputMode}
                                  onChange={(event) => changeAllocationInputMode(l.key, event.target.value as AllocationInputMode)}
                                >
                                  <option value="percent">{t('allocation_percent')}</option>
                                  <option value="amount">{t('allocation_amount')}</option>
                                </Select>
                              </div>
                            )}
                          </div>

                          {l.allocationKind !== 'none' && (
                            <div className="mt-3 space-y-2">
                              {l.allocations.map((allocation, allocationIndex) => (
                                <div key={`${l.key}-allocation-${allocationIndex}`} className="grid grid-cols-1 items-end gap-2 sm:grid-cols-[minmax(0,1fr)_minmax(0,180px)_auto]">
                                  <div className="space-y-1.5">
                                    <Label htmlFor={`line-center-${l.key}-${allocationIndex}`}>{t('allocation_center')}</Label>
                                    <Select
                                      id={`line-center-${l.key}-${allocationIndex}`}
                                      value={allocation.costCenterId}
                                      onChange={(event) => patchAllocation(l.key, allocationIndex, { costCenterId: event.target.value })}
                                    >
                                      <option value="">{t('no_center')}</option>
                                      {centers.map((center) => (
                                        <option
                                          key={center.id}
                                          value={center.id}
                                          disabled={center.id !== allocation.costCenterId && l.allocations.some((item) => item.costCenterId === center.id)}
                                        >
                                          {center.code} — {center.name}
                                        </option>
                                      ))}
                                    </Select>
                                  </div>
                                  <div className="space-y-1.5">
                                    <Label htmlFor={`line-center-value-${l.key}-${allocationIndex}`}>
                                      {l.allocationInputMode === 'percent' ? t('allocation_value_percent') : t('allocation_value_amount')}
                                    </Label>
                                    <Input
                                      id={`line-center-value-${l.key}-${allocationIndex}`}
                                      className="num text-end"
                                      inputMode="decimal"
                                      placeholder="0"
                                      value={allocation.value}
                                      onChange={(event) => patchAllocation(l.key, allocationIndex, { value: event.target.value })}
                                    />
                                  </div>
                                  <Button
                                    type="button"
                                    variant="ghost"
                                    size="icon"
                                    className="mb-0.5"
                                    aria-label={t('allocation_remove')}
                                    onClick={() => removeAllocation(l.key, allocationIndex)}
                                  >
                                    <Trash2 className="h-4 w-4 text-negative" strokeWidth={1.7} />
                                  </Button>
                                </div>
                              ))}

                              <div className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-2">
                                <Button type="button" variant="outline" size="sm" onClick={() => addAllocation(l.key)}>
                                  <Plus className="h-3.5 w-3.5" strokeWidth={1.8} />{t('allocation_add')}
                                </Button>
                                <div className="text-end text-xs" aria-live="polite">
                                  <p className="text-muted">
                                    {t('allocation_total')}: <span className="num text-text">
                                      {allocationTotal === null
                                        ? '—'
                                        : l.allocationInputMode === 'percent'
                                          ? `${basisPointsToPercent(allocationTotal)}%`
                                          : formatRiyal(allocationTotal / 100)}
                                    </span> {t('allocation_of_line')}
                                  </p>
                                  {remaining !== null && (
                                    <p className={cn('num', remaining === 0 ? 'text-positive' : 'text-negative')}>
                                      {remaining === 0
                                        ? t('allocation_complete')
                                        : `${t('allocation_remaining')}: ${l.allocationInputMode === 'percent' ? `${basisPointsToPercent(Math.abs(remaining))}%` : formatRiyal(Math.abs(remaining) / 100)}`}
                                    </p>
                                  )}
                                </div>
                              </div>
                              <p className="text-[11px] leading-relaxed text-muted">{t('allocation_hint')}</p>
                              {allocationIssue && <p className="text-xs text-negative" role="alert">{allocationIssue}</p>}
                            </div>
                          )}
                        </div>
                      );
                    })()}
                  </div>
                );
              })}
            </CardContent>
          </Card>

          {/* الخصم والشحن على مستوى الفاتورة */}
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Tag className="h-4 w-4 text-primary" strokeWidth={1.8} />{t('discount_shipping')}</CardTitle></CardHeader>
            <CardContent>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-4">
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
                    <Input id="dval" inputMode="decimal" className="num text-end pe-12" placeholder="0" value={discountInput} onChange={(e) => setDiscountInput(e.target.value)} />
                    <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-xs text-muted">{discountMode === 'percent' ? '%' : '﷼'}</span>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="ship">{t('shipping')}</Label>
                  <div className="relative">
                    <Input id="ship" inputMode="decimal" className="num text-end pe-12" placeholder="0" value={shippingInput} onChange={(e) => setShippingInput(e.target.value)} />
                    <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-xs text-muted">﷼</span>
                  </div>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="adj">{t('adjustment')}</Label>
                  <div className="relative">
                    <Input id="adj" inputMode="decimal" dir="ltr" className="num text-end pe-12" placeholder="0" value={adjustmentInput} onChange={(e) => setAdjustmentInput(e.target.value)} />
                    <span className="pointer-events-none absolute inset-y-0 end-3 flex items-center text-xs text-muted">﷼</span>
                  </div>
                </div>
              </div>
              <p className="mt-2 text-[11px] text-muted">{t('adjustment_hint')}</p>
            </CardContent>
          </Card>

          {/* الملاحظات */}
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><StickyNote className="h-4 w-4 text-primary" strokeWidth={1.8} />{t('notes')}</CardTitle></CardHeader>
            <CardContent>
              <textarea
                value={notes}
                onChange={(e) => setNotes(e.target.value)}
                rows={3}
                className="min-h-20 w-full resize-y rounded border border-border bg-surface px-3 py-2 text-sm text-text placeholder:text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
                placeholder={t('notes')}
              />
            </CardContent>
          </Card>
        </div>

        {/* الملخّص الجانبي اللاصق */}
        <aside className="lg:sticky lg:top-4 lg:self-start">
          <Card>
            <CardHeader><CardTitle>{t('summary_title')}</CardTitle></CardHeader>
            <CardContent className="space-y-2 text-sm">
              <div className="flex justify-between text-muted"><span>{t('subtotal')}</span><span className="num">{formatRiyal(subMinor / 100)}</span></div>
              {discountMinor > 0 && (
                <div className="flex justify-between text-muted"><span>{t('discount')}</span><span className="num text-positive">-{formatRiyal(discountMinor / 100)}</span></div>
              )}
              {shippingMinor > 0 && (
                <div className="flex justify-between text-muted"><span>{t('shipping')}</span><span className="num">{formatRiyal(shippingMinor / 100)}</span></div>
              )}
              <div className="flex justify-between text-muted"><span>{t('tax_total')}</span><span className="num">{formatRiyal(taxMinor / 100)}</span></div>
              {adjustmentMinor !== 0 && (
                <div className="flex justify-between text-muted"><span>{t('adjustment')}</span><span className="num">{adjustmentMinor > 0 ? '+' : ''}{formatRiyal(adjustmentMinor / 100)}</span></div>
              )}
              <div className="flex items-baseline justify-between border-t border-border pt-2">
                <span className="font-semibold text-text">{t('total')}</span>
                <span className="num text-2xl font-bold text-primary-hover">{formatRiyal(totalMinor / 100)}</span>
              </div>

              {/* ═══ مدفوع بالفعل ═══
                  التأشير يعني تحصيل الإجمالي كاملاً لحظة الترحيل: الفاتورة على
                  1130 ثم **سند قبض مرحَّل** يقفلها (مدين الخزينة · دائن 1130).
                  التسمية تلفّ المربّع والنصّ معاً فتُنقر كلّها. */}
              <div className="border-t border-border pt-3">
                <label className="flex cursor-pointer items-center gap-2 py-0.5 text-sm font-medium text-text">
                  <input
                    type="checkbox"
                    className="h-4 w-4 shrink-0 accent-primary"
                    checked={isPaid}
                    onChange={(e) => setIsPaid(e.target.checked)}
                  />
                  {t('paid_already')}
                </label>

                {/* **إخفاء بصري لا إزالة**: الحقول تبقى في الـ DOM وقيمها في
                    الحالة، فإلغاء الخانة لا يُفقد ما أُدخل، وإعادة التأشير
                    تُظهره كما تُرك. والارتفاع ينتقل بلطف فلا تقفز الأزرار.
                    و`invisible` ضرورية فوق قصّ الارتفاع: المقصوص وحده يبقى في
                    شجرة الوصولية وقابلاً للتركيز، فيُملى على المستخدم حقلٌ لا
                    يراه. */}
                <div
                  className={cn(
                    'grid transition-[grid-template-rows] duration-150 ease-out',
                    isPaid ? 'grid-rows-[1fr]' : 'grid-rows-[0fr]'
                  )}
                >
                  <div className={cn('overflow-hidden', !isPaid && 'invisible')}>
                    <div className="space-y-2.5 pt-3" aria-hidden={!isPaid}>
                      <div className="space-y-1.5">
                        <Label htmlFor="pay-method">{t('payment_method')}</Label>
                        <Select
                          id="pay-method" value={payMethod} tabIndex={isPaid ? undefined : -1}
                          onChange={(e) => setPayMethod(e.target.value)}
                        >
                          <option value="cash">{t('method_cash')}</option>
                          <option value="transfer">{t('method_transfer')}</option>
                          <option value="card">{t('method_card')}</option>
                        </Select>
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="pay-ref">{t('payment_reference')}</Label>
                        <Input
                          id="pay-ref" dir="ltr" className="num" value={payReference}
                          tabIndex={isPaid ? undefined : -1}
                          onChange={(e) => setPayReference(e.target.value)}
                        />
                      </div>
                      <div className="space-y-1.5">
                        <Label htmlFor="pay-account">{t('cash_account')}</Label>
                        <Select
                          id="pay-account" value={cashAccountId} tabIndex={isPaid ? undefined : -1}
                          onChange={(e) => setCashAccountId(e.target.value)}
                        >
                          {/* الافتراضية = خزينة الأداة (1110 للنقد، 1120 للتحويل/البطاقة). */}
                          <option value="">{t('cash_account_main')}</option>
                          {cashAccounts.map((a) => (
                            <option key={a.id} value={a.id}>{a.code} — {a.name}</option>
                          ))}
                        </Select>
                      </div>
                    </div>
                  </div>
                </div>
              </div>

              {error && <p className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}
              <Button className="mt-2 w-full" disabled={!canSave} onClick={() => submit(true)}>{t('save_post')}</Button>
              <Button variant="outline" className="w-full" disabled={!canSave} onClick={() => submit(false)}>{t('save_draft')}</Button>
              <p className="pt-1 text-[11px] leading-relaxed text-muted">{t('summary_hint')}</p>
            </CardContent>
          </Card>
        </aside>
      </div>
    </div>
  );
}
