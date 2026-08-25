'use client';

import Link from 'next/link';
import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Plus, Trash2, Users, Package, FileText, Paperclip, Percent, Truck, Wallet } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { FormActions, FormAlert, FormPage } from '@/components/nebrax';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { NumberPreviewField } from '@/components/ui/number-preview-field';
import { Select } from '@/components/ui/select';
import { Combobox, type ComboOption } from '@/components/ui/combobox';
import { useToast } from '@/components/ui/toast';
import { PartnerDialog } from '@/components/partners/partner-dialog';
import { ProductDialog } from '@/components/products/product-dialog';
import { api, ApiError } from '@/lib/api';
import { useNumberPreview } from '@/lib/use-number-preview';
import { formatRiyal, riyalToMinor } from '@/lib/money';
import { getSystemTaxInclusive } from '@/lib/tax';
import { cn } from '@/lib/utils';
import type { Warehouse } from '@/lib/warehouse';

interface Partner { id: string; name: string; type: string; phone?: string | null; vat_number?: string | null }
interface ProductUnit { name: string; factor: number }
interface Product {
  id: string; name: string; sku: string | null; barcode: string | null; purchase_price: string;
  tax_rate: number; is_active: boolean; track_inventory: boolean;
  quantity_on_hand: number; units?: ProductUnit[];
}
interface CostCenter { id: string; code: string; name: string; is_active: boolean }
interface ApiLine {
  product_id: string | null; description: string | null; quantity: number;
  unit_name: string | null; unit_price: string; tax_rate: number; line_discount?: string;
}
interface StoredAttachment { id: string; original_name: string; mime_type: string | null; size: number; created_at?: string | null }

interface ApiPurchase {
  partner_id: string; warehouse_id: string | null; cost_center_id: string | null; payment_type: string;
  purchase_date: string | null; supplier_invoice_no: string | null;
  tax_inclusive: boolean; notes?: string | null; lines: ApiLine[];
  discount?: string; shipping?: string; adjustment?: string;
  paid_on_post?: string; payment_method?: string;
  received_status?: string; received_date?: string | null;
  attachments?: StoredAttachment[];
}

interface Line {
  key: string;
  productId: string | null;
  description: string;
  unit: string;
  qty: string;
  price: string;
  disc: string;
  tax: string;
}

let lineSeq = 0;
// الكمية تبدأ فارغة لا `1`: الواحد الافتراضي يمرّ دون أن يقرأه أحد، فتُحفظ
// فاتورةٌ بكمية لم يقصدها المستخدم. الفراغ يوقف الحفظ ويطلب رقماً صريحاً.
const newLine = (): Line => ({
  key: `p${++lineSeq}`, productId: null, description: '', unit: '', qty: '', price: '', disc: '', tax: '15',
});

/**
 * أعمدة سطر البند على الديسكتوب.
 *
 * مساراتٌ صريحة لا `grid-cols-12`: العمود الواحد من اثني عشر يساوي ≈٥٨px عند
 * 768px، وهو أضيق من أن يُظهر «١٥» في خانة الضريبة كاملة. الحدّ الأدنى لكل
 * مسار مقدَّرٌ بما يسع أطول قيمة متوقَّعة فيه، ومجموع الحدود الدنيا مع الفواصل
 * ≈٦٨٠px فيتّسع في التابلت بلا تمرير أفقي، ثم تتمدّد بالنسب على الشاشات الأعرض.
 */
const LINE_GRID =
  'md:grid-cols-[minmax(6.5rem,2.2fr)_minmax(5rem,1.5fr)_minmax(4.5rem,1fr)_minmax(9rem,1.4fr)_3.75rem_3.5rem_minmax(4.5rem,1fr)_2.25rem]';

/**
 * حقلٌ داخل سطر البند: تسميةٌ ظاهرة على الجوال ومخفيّةٌ على الديسكتوب حيث يغني
 * عنها رأس الأعمدة. تبقى في الشجرة (`sr-only` لا `hidden`) فيسمع قارئ الشاشة
 * اسم الحقل في المقاسين معاً.
 */
function LineField({
  label, htmlFor, children,
}: { label: string; htmlFor: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0">
      <Label htmlFor={htmlFor} className="mb-0.5 block text-[11px] font-medium text-muted md:sr-only md:mb-0">
        {label}
      </Label>
      {children}
    </div>
  );
}

/**
 * الكمية صالحة إذا كانت عدداً موجباً لا يقلّ عن واحد.
 *
 * الفراغ **ليس صفراً ولا واحداً** — هو غيابُ قرار، فيمنع الحفظ بدل أن يُترجَم
 * إلى كميةٍ لم يكتبها أحد. الحدّ الأدنى واحد يطابق `min={1}` على الحقل ويجعل
 * التقريب في `submit` بلا أثر.
 */
function hasValidQty(line: Line): boolean {
  const raw = line.qty.trim();
  if (raw === '') return false;
  const value = Number(raw);
  return Number.isFinite(value) && value >= 1;
}

/**
 * ═══════════════════════════════════════════════════════════════
 *  نموذج فاتورة شراء
 * ═══════════════════════════════════════════════════════════════
 *  **لماذا صفحة كاملة بدل النافذة السابقة:** النافذة لم تكن تختار منتجاً
 *  أصلاً، فكل سطورها وصفية وتُرحَّل إلى «5150 مصروفات عامة» — أي أن البضاعة
 *  تُصرَف مصروف الفترة بدل أن تُرسمَل مخزوناً، ولا تدخل كمية ولا يتحرّك
 *  متوسط تكلفة. اختيار المنتج هنا هو الإصلاح، لا زينة.
 *
 *  **والمنتج إلزامي على كل سطر** (يفرضه `StorePurchaseRequest` أيضاً، لا
 *  الشاشة وحدها). ومصروفات فاتورة المورّد لم تُغلَق: الشحن والتخليص يُدخَلان
 *  بمنتج **خدمي غير متابَع مخزونياً** فيبقى ترحيلهما إلى 5150 كما كان —
 *  لكنهما بندٌ يُبحث عنه ويُقاس لا نصٌّ حرّ بإملاء مختلف كل مرة.
 */
export function PurchaseForm({ editId }: { editId?: string } = {}) {
  const t = useTranslations('purchaseForm');
  const tf = useTranslations('invoiceForm');
  const tc = useTranslations('common');
  const router = useRouter();
  const { success, error: showError } = useToast();

  const [partners, setPartners] = useState<Partner[]>([]);
  const [products, setProducts] = useState<Product[]>([]);
  const [centers, setCenters] = useState<CostCenter[]>([]);
  const [warehouses, setWarehouses] = useState<Warehouse[]>([]);

  const [partnerId, setPartnerId] = useState('');
  const [warehouseId, setWarehouseId] = useState('');
  const [centerId, setCenterId] = useState('');
  const [paymentType, setPaymentType] = useState('credit');
  const [date, setDate] = useState('');
  const [termDays, setTermDays] = useState('');
  const [supplierInvoiceNo, setSupplierInvoiceNo] = useState('');
  const [taxInclusive, setTaxInclusive] = useState(false);
  const [notes, setNotes] = useState('');
  const [discountInput, setDiscountInput] = useState('');
  const [shippingInput, setShippingInput] = useState('');
  const [adjustmentInput, setAdjustmentInput] = useState('');
  const [paidNow, setPaidNow] = useState(false);
  const [paidInput, setPaidInput] = useState('');
  const [payMethod, setPayMethod] = useState('cash');
  const [receivedStatus, setReceivedStatus] = useState('received');
  const [receivedDate, setReceivedDate] = useState('');
  const [lines, setLines] = useState<Line[]>([newLine()]);
  const [newSupplier, setNewSupplier] = useState(false);
  // السطر الذي فُتحت من منتقيه نافذة «منتج جديد» — ليُختار فيه تلقائياً بعد الحفظ.
  const [newProductFor, setNewProductFor] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [loadingDoc, setLoadingDoc] = useState(!!editId);
  const [pendingAttachments, setPendingAttachments] = useState<File[]>([]);
  const [storedAttachments, setStoredAttachments] = useState<StoredAttachment[]>([]);
  const [uploadingAttachments, setUploadingAttachments] = useState(false);
  const attachmentInputRef = useRef<HTMLInputElement>(null);
  const { number: suggestedNumber, loading: loadingNumber } = useNumberPreview('purchase', { date, enabled: !editId });

  const loadPartners = useCallback(
    () => api<{ data: Partner[] }>('/partners')
      .then((r) => setPartners(r.data.filter((p) => ['supplier', 'both'].includes(p.type))))
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
    loadPartners();
    loadProducts();
    api<{ data: CostCenter[] }>('/cost-centers').then((r) => setCenters(r.data.filter((c) => c.is_active))).catch(() => {});
    api<{ data: Warehouse[] }>('/warehouses').then((r) => {
      const active = r.data.filter((warehouse) => warehouse.is_active);
      setWarehouses(active);
      if (!editId) setWarehouseId((current) => current || active.find((warehouse) => warehouse.is_default)?.id || active[0]?.id || '');
    }).catch(() => {});
    getSystemTaxInclusive().then(setTaxInclusive).catch(() => {});
  }, [editId, loadPartners, loadProducts]);

  // تحميل المسوّدة للتعديل وملء الحقول. المرحّلة يرفضها الخادم، وزرّ التعديل
  // معطّل عليها في الشاشتين — فلا يصل المستخدم إلى هنا بمرحّلة إلا بالمسار.
  useEffect(() => {
    if (!editId) return;
    setLoadingDoc(true);
    api<{ data: ApiPurchase }>(`/purchases/${editId}`)
      .then((r) => {
        const d = r.data;
        setPartnerId(d.partner_id);
        setWarehouseId(d.warehouse_id ?? '');
        setCenterId(d.cost_center_id ?? '');
        setPaymentType(d.payment_type);
        setDate(d.purchase_date ?? '');
        setSupplierInvoiceNo(d.supplier_invoice_no ?? '');
        setTaxInclusive(!!d.tax_inclusive);
        setNotes(d.notes ?? '');
        setDiscountInput(Number(d.discount) > 0 ? String(d.discount) : '');
        setShippingInput(Number(d.shipping) > 0 ? String(d.shipping) : '');
        setAdjustmentInput(Number(d.adjustment) !== 0 ? String(d.adjustment) : '');
        setPaidNow(Number(d.paid_on_post) > 0);
        setPaidInput(Number(d.paid_on_post) > 0 ? String(d.paid_on_post) : '');
        setPayMethod(d.payment_method ?? 'cash');
        setReceivedStatus(d.received_status ?? 'received');
        setReceivedDate(d.received_date ?? '');
        setStoredAttachments(d.attachments ?? []);
        setLines(
          d.lines.length
            ? d.lines.map((l) => ({
                key: `p${++lineSeq}`,
                productId: l.product_id,
                description: l.description ?? '',
                unit: l.unit_name ?? '',
                qty: String(l.quantity),
                price: l.unit_price,
                disc: l.line_discount && Number(l.line_discount) > 0 ? l.line_discount : '',
                tax: String(l.tax_rate),
              }))
            : [newLine()]
        );
      })
      .catch(() => setError(tc('loadFailed')))
      .finally(() => setLoadingDoc(false));
  }, [editId, tc]);

  // الرقم الضريبي في `sub` ليبحث فيه المنتقي فعلاً — نصّ البحث يَعِد به.
  const supplierOptions = useMemo<ComboOption[]>(
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
      // الرمز والباركود معاً في السطر الثاني — كلاهما يُبحث فيه، فالمستخدم
      // يمسح الباركود أو يكتب رقم الصنف حسب ما بين يديه.
      sub: [p.sku, p.barcode].filter(Boolean).join('  ·  ') || undefined,
      // الرصيد للمتابَع مخزونياً وحده — «الرصيد ٠» على خدمةٍ رقمٌ بلا معنى.
      hint: p.track_inventory ? `${t('balance')} ${p.quantity_on_hand}` : undefined,
    })),
    [products, t]
  );

  const setLine = (key: string, patch: Partial<Line>) =>
    setLines((ls) => ls.map((l) => (l.key === key ? { ...l, ...patch } : l)));
  const addLine = () => setLines((ls) => [...ls, newLine()]);
  const removeLine = (key: string) =>
    setLines((ls) => (ls.length > 1 ? ls.filter((l) => l.key !== key) : [newLine()]));

  function selectAttachments(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;
    if (pendingAttachments.length + files.length > 10) {
      setError(t('attachments_limit'));
      return;
    }
    const allowed = ['application/pdf', 'application/msword', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'application/vnd.ms-excel', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'text/csv', 'image/jpeg', 'image/png', 'image/gif', 'application/zip'];
    if (files.some((file) => !allowed.includes(file.type) || file.size > 10 * 1024 * 1024)) {
      setError(t('attachments_invalid'));
      return;
    }
    setPendingAttachments((current) => [...current, ...files]);
  }

  function removePendingAttachment(index: number) {
    setPendingAttachments((current) => current.filter((_, itemIndex) => itemIndex !== index));
  }

  async function uploadAttachments(purchaseId: string): Promise<boolean> {
    if (pendingAttachments.length === 0) return true;
    setUploadingAttachments(true);
    try {
      const body = new FormData();
      pendingAttachments.forEach((file) => body.append('attachments[]', file));
      const result = await api<{ data: StoredAttachment[] }>(`/purchases/${purchaseId}/attachments`, { method: 'POST', body });
      setStoredAttachments(result.data);
      setPendingAttachments([]);
      return true;
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('attachments_upload_failed');
      setError(message);
      showError(message);
      return false;
    } finally {
      setUploadingAttachments(false);
    }
  }

  async function removeStoredAttachment(attachmentId: string) {
    if (!editId) return;
    try {
      await api(`/purchases/${editId}/attachments/${attachmentId}`, { method: 'DELETE' });
      setStoredAttachments((current) => current.filter((attachment) => attachment.id !== attachmentId));
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('attachments_delete_failed');
      setError(message);
      showError(message);
    }
  }

  /** اختيار المنتج يملأ التكلفة والضريبة، ويُصفّر الوحدة (قالب المنتج تغيّر). */
  function pickProduct(key: string, productId: string) {
    const p = products.find((x) => x.id === productId);
    if (!p) return; // المنتج إلزامي — لا يُمحى باختيارٍ فارغ
    setLine(key, {
      productId: p.id, description: p.name, price: p.purchase_price,
      tax: String(p.tax_rate), unit: '',
    });
  }

  // معاينة الإجماليات بالهللات — بلا float، مطابقة للـ backend.
  const lineGross = (l: Line) => (Number(l.qty) || 0) * riyalToMinor(l.price);
  const totals = useMemo(() => {
    let net = 0, tax = 0;
    for (const l of lines) {
      const gross = Math.max(0, lineGross(l) - riyalToMinor(l.disc));
      const rate = Number(l.tax) || 0;
      if (taxInclusive) {
        const t = rate <= 0 || gross <= 0 ? 0 : Math.round((gross * rate) / (100 + rate));
        net += gross - t; tax += t;
      } else {
        net += gross; tax += Math.round((gross * rate) / 100);
      }
    }

    // الخصم يخفّض الأساس والشحن يرفعه، والضريبة تُعاد نسبتُها عليهما — مطابقة
    // لـ`applyHeadAdjustments` في الخادم حرفياً، فلا تخالف المعاينةُ المحفوظ.
    const discount = Math.min(riyalToMinor(discountInput), net);
    const shipping = riyalToMinor(shippingInput);
    const adjustment = riyalToMinor(adjustmentInput);
    const base = net - discount + shipping;
    const taxNet = net > 0 ? Math.trunc((tax * base) / net) : 0;

    return { net, tax: taxNet, discount, shipping, adjustment, base, total: base + taxNet + adjustment };
  }, [lines, taxInclusive, discountInput, shippingInput, adjustmentInput]);

  // ═══════════════════════════════════════════════════════════════
  //  السداد الفوري — «نقدي» يعني مسدَّدة بالكامل
  // ═══════════════════════════════════════════════════════════════
  //  فلا خانةَ مبلغٍ معه: قيمتُها الإجمالي دائماً، وإظهارها قابلةً للتحرير
  //  يَعِد بدفعةٍ جزئية لا يقبلها الخادم. الجزئي مسارُه «آجل».
  const isCash = paymentType === 'cash';
  const paidMinor = isCash
    ? totals.total
    : paidNow ? Math.min(riyalToMinor(paidInput), totals.total) : 0;
  const remainingMinor = Math.max(0, totals.total - paidMinor);

  // **المنتج إلزامي على كل سطر.** بلا منتج لا يُعرَف أهي بضاعةٌ تُرسمَل مخزوناً
  // أم مصروفُ فترة، فتسقط كلّها في «5150 مصروفات عامة». والحفظ يُمنع هنا قبل
  // أن يرفضه الخادم — رسالةٌ عند الضغط أوضح من طلبٍ يعود بخطأ.
  // والكمية كذلك مطلوبة على **كل** سطر لا على سطرٍ منها: `submit` يُسقط السطر
  // بلا كمية صالحة من الحمولة، فالسماح بالحفظ حينها يحذف بنداً كتبه المستخدم
  // بلا خبر. المنع هنا يجعل الحذف الصامت مستحيلاً.
  const canSave =
    !!partnerId && !saving && !loadingDoc &&
    lines.every((l) => !!l.productId) &&
    lines.every(hasValidQty) &&
    lines.some((l) => lineGross(l) > 0);

  /** شروط الدفع بالأيام ⇒ تاريخ استحقاق. الفراغ يعني بلا استحقاق. */
  const dueDate = useMemo(() => {
    const days = Number(termDays);
    if (!date || !Number.isFinite(days) || days <= 0) return null;
    const d = new Date(date);
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  }, [date, termDays]);

  async function submit(post: boolean) {
    setSaving(true);
    setError(null);
    const items = lines
      .filter((l) => l.productId && (Number(l.qty) || 0) > 0 && riyalToMinor(l.price) >= 0)
      .map((l) => ({
        product_id: l.productId,
        description: l.description || null,
        quantity: Math.floor(Number(l.qty)) || 1,
        unit: l.unit || null,
        unit_price: riyalToMinor(l.price),
        discount: riyalToMinor(l.disc),
        tax_rate: Number(l.tax) || 0,
      }));

    if (items.length === 0) { setError(t('need_line')); setSaving(false); return; }

    try {
      const body = {
          partner_id: partnerId,
          warehouse_id: warehouseId || null,
          cost_center_id: centerId || null,
          payment_type: paymentType,
          purchase_date: date || null,
          due_date: dueDate,
          supplier_invoice_no: supplierInvoiceNo || null,
          tax_inclusive: taxInclusive,
          discount: totals.discount,
          shipping: totals.shipping,
          adjustment: totals.adjustment,
          // النقدي يُسدَّد كاملاً بحساب الخادم لحظة الترحيل، فلا يُخزَّن له مبلغ
          // هنا: مبلغٌ محفوظ على مسوّدةٍ تتغيّر سطورُها يصير قديماً بصمت.
          paid_on_post: isCash ? 0 : paidMinor,
          payment_method: payMethod,
          received_status: receivedStatus,
          received_date: receivedDate || null,
          notes: notes || null,
          items,
      };
      const id = editId
        ? (await api<{ data: { id: string } }>(`/purchases/${editId}`, { method: 'PUT', body })).data.id
        : (await api<{ data: { id: string } }>('/purchases', { method: 'POST', body })).data.id;
      if (!await uploadAttachments(id)) {
        setSaving(false);
        return;
      }
      if (post) await api(`/purchases/${id}/post`, { method: 'POST' });
      success(tc(editId ? 'updated' : 'created'));
      router.push('/purchases');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  const totalsAside = (
    <Card>
      <CardHeader><CardTitle>{t('totals')}</CardTitle></CardHeader>
      <CardContent className="space-y-2 text-sm">
        <div className="flex items-center justify-between gap-3">
          <span className="text-muted">{t('tax_mode')}</span>
          <Select
            className="w-40" value={taxInclusive ? '1' : '0'}
            onChange={(e) => setTaxInclusive(e.target.value === '1')}
            aria-label={t('tax_mode')}
          >
            <option value="0">{t('tax_exclusive')}</option>
            <option value="1">{t('tax_inclusive')}</option>
          </Select>
        </div>
        <Row label={t('subtotal')} value={formatRiyal(totals.net / 100)} />
        {totals.discount > 0 && (
          <Row label={t('discount')} value={`− ${formatRiyal(totals.discount / 100)}`} />
        )}
        {totals.shipping > 0 && <Row label={t('shipping')} value={formatRiyal(totals.shipping / 100)} />}
        <Row label={t('tax_amount')} value={formatRiyal(totals.tax / 100)} />
        {totals.adjustment !== 0 && (
          <Row label={t('adjustment')} value={formatRiyal(totals.adjustment / 100)} />
        )}
        <div className="flex items-center justify-between border-t border-border pt-2 font-semibold text-text">
          <span>{t('total')}</span>
          <span className="num">{formatRiyal(totals.total / 100)}</span>
        </div>

        {/* المدفوع والمتبقي — الرقمان اللذان يقرّر بهما المستخدم قبل
            الترحيل، فيُعرَضان معه لا في قسم الدفع وحده. */}
        {paidMinor > 0 && (
          <>
            <Row label={t('paid')} value={`− ${formatRiyal(paidMinor / 100)}`} />
            <div className="flex items-center justify-between border-t border-border pt-2 text-text">
              <span>{t('remaining')}</span>
              <span className="num font-semibold">{formatRiyal(remainingMinor / 100)}</span>
            </div>
          </>
        )}
      </CardContent>
    </Card>
  );

  return (
    <FormPage
      width="full"
      backHref="/purchases"
      backLabel={tf('back')}
      title={editId ? t('edit_title') : t('new_title')}
      status={!editId ? (
        <Button asChild variant="outline">
          <Link href="/documents?document_type=purchase_invoice&status=ready_for_draft">{t('import_from_document')}</Link>
        </Button>
      ) : undefined}
      aside={totalsAside}
      actions={
        <FormActions
          secondary={<>
            <Button asChild type="button" variant="ghost"><Link href='/purchases'>{tf('cancel')}</Link></Button>
            <Button type="button" variant="outline" disabled={!canSave} onClick={() => submit(false)}>{t('save_draft')}</Button>
          </>}
          primary={<Button type="button" disabled={!canSave} onClick={() => submit(true)}>{t('save_post')}</Button>}
        />
      }
    >
      {/* ═══ المورد ═══ */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Users className="h-4 w-4 text-primary" strokeWidth={1.8} />{t('supplier_section')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="supplier">{t('supplier')} *</Label>
              <div className="flex items-center gap-2">
                <Combobox
                  id="supplier"
                  className="min-w-0 flex-1"
                  value={partnerId}
                  onChange={setPartnerId}
                  options={supplierOptions}
                  placeholder={t('pick_supplier')}
                  searchPlaceholder={t('search_supplier')}
                  emptyText={t('no_supplier_found')}
                  clearLabel={t('pick_supplier')}
                />
                <Button type="button" variant="outline" onClick={() => setNewSupplier(true)}>
                  <Plus className="h-4 w-4" strokeWidth={1.7} />
                  {t('new_supplier')}
                </Button>
              </div>
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="pt">{t('payment_type')}</Label>
              <Select id="pt" value={paymentType} onChange={(e) => setPaymentType(e.target.value)}>
                <option value="credit">{t('credit')}</option>
                <option value="cash">{t('cash')}</option>
              </Select>
            </div>

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

            {!editId && <NumberPreviewField id="purchase-number" label={t('number')} number={suggestedNumber} loading={loadingNumber} />}

            <div className="space-y-1.5">
              <Label htmlFor="date">{t('date')}</Label>
              <Input id="date" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="terms">{t('payment_terms')}</Label>
              <div className="flex items-center gap-2">
                <Input
                  id="terms" className="num text-end" type="number" min={0} inputMode="numeric"
                  value={termDays} onChange={(e) => setTermDays(e.target.value)}
                />
                <span className="shrink-0 text-sm text-muted">{t('day')}</span>
              </div>
              {dueDate && <p className="num text-xs text-muted">{t('due_on')} {dueDate}</p>}
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="supplier-no">{t('supplier_invoice_no')}</Label>
              <Input id="supplier-no" value={supplierInvoiceNo} onChange={(e) => setSupplierInvoiceNo(e.target.value)} />
            </div>

            <div className="space-y-1.5">
              <Label htmlFor="center">{t('cost_center')}</Label>
              <Select id="center" value={centerId} onChange={(e) => setCenterId(e.target.value)}>
                <option value="">{t('no_cost_center')}</option>
                {centers.map((c) => (<option key={c.id} value={c.id}>{c.code} — {c.name}</option>))}
              </Select>
            </div>
          </div>
        </CardContent>
      </Card>

      {/* ═══ البنود ═══ */}
      <Card>
        <CardHeader className="flex flex-row items-center justify-between">
          <CardTitle className="flex items-center gap-2">
            <Package className="h-4 w-4 text-primary" strokeWidth={1.8} />{t('items_section')}
          </CardTitle>
          <Button type="button" variant="ghost" size="sm" onClick={addLine}>
            <Plus className="h-4 w-4" strokeWidth={1.7} />{t('add_line')}
          </Button>
        </CardHeader>
        <CardContent className="space-y-2">
          {/* رأس الأعمدة للديسكتوب وحده — على الجوال لكل حقلٍ تسميتُه. */}
          <div className={cn('hidden gap-2 px-1 text-[11px] font-medium text-muted md:grid', LINE_GRID)}>
            <div>{t('item')}</div>
            <div>{t('description')}</div>
            <div className="text-end">{t('unit_price')}</div>
            <div className="text-end">{t('qty')}</div>
            <div className="text-end">{t('line_discount')}</div>
            <div className="text-end">{t('tax')}</div>
            <div className="text-end">{t('line_total')}</div>
            <div />
          </div>

          {lines.map((l) => {
            const units = products.find((p) => p.id === l.productId)?.units ?? [];
            const gross = lineGross(l);
            const rate = Number(l.tax) || 0;
            const withTax = taxInclusive ? gross : gross + Math.round((gross * rate) / 100);
            return (
              <div
                key={l.key}
                className={cn(
                  // الجوال: عمودٌ واحد بفواصل ٦px وحشوٍ ضيّق — كل حقلٍ كامل العرض
                  // ومعه تسميتُه، والبطاقة مع ذلك تبقى قصيرة.
                  'space-y-1.5 rounded-lg border border-border p-2',
                  'md:items-center md:gap-2 md:space-y-0 md:rounded-none md:border-0 md:p-0 md:grid',
                  LINE_GRID
                )}
              >
                <LineField label={t('item')} htmlFor={`${l.key}-product`}>
                  <Combobox
                    id={`${l.key}-product`}
                    value={l.productId ?? ''}
                    onChange={(v) => pickProduct(l.key, v)}
                    options={productOptions}
                    placeholder={t('pick_product')}
                    searchPlaceholder={t('search_product')}
                    emptyText={t('no_product_found')}
                    footerLabel={t('new_product')}
                    onFooterClick={() => setNewProductFor(l.key)}
                    aria-label={t('item')}
                  />
                </LineField>

                <LineField label={t('description')} htmlFor={`${l.key}-description`}>
                  <Input
                    id={`${l.key}-description`} placeholder={t('description')}
                    value={l.description}
                    onChange={(e) => setLine(l.key, { description: e.target.value })}
                  />
                </LineField>

                <LineField label={t('unit_price')} htmlFor={`${l.key}-price`}>
                  <Input
                    id={`${l.key}-price`} className="num text-end" inputMode="decimal" dir="ltr" placeholder="0.00"
                    value={l.price} onChange={(e) => setLine(l.key, { price: e.target.value })}
                  />
                </LineField>

                {/* الوحدة تنزل تحت الكمية على الجوال فلا تضغط خانتها، وتعود
                    بجانبها على الديسكتوب حيث للخليّة عرضٌ يكفيهما. */}
                <LineField label={t('qty')} htmlFor={`${l.key}-qty`}>
                  <div className="space-y-1.5 md:flex md:items-center md:gap-1 md:space-y-0">
                    <Input
                      id={`${l.key}-qty`} className="num text-end md:flex-1" type="number" min={1} dir="ltr"
                      placeholder={t('qty')}
                      value={l.qty} onChange={(e) => setLine(l.key, { qty: e.target.value })}
                    />
                    {units.length >= 2 && (
                      <Select
                        className="md:w-20 md:shrink-0" value={l.unit} aria-label={t('unit')}
                        onChange={(e) => setLine(l.key, { unit: e.target.value })}
                      >
                        {units.map((u) => (
                          <option key={u.name} value={u.factor === 1 ? '' : u.name}>{u.name}</option>
                        ))}
                      </Select>
                    )}
                  </div>
                </LineField>

                <LineField label={t('line_discount')} htmlFor={`${l.key}-discount`}>
                  <Input
                    id={`${l.key}-discount`} className="num text-end" inputMode="decimal" dir="ltr" placeholder="0"
                    value={l.disc} onChange={(e) => setLine(l.key, { disc: e.target.value })}
                  />
                </LineField>

                <LineField label={t('tax')} htmlFor={`${l.key}-tax`}>
                  <Input
                    id={`${l.key}-tax`} className="num text-end" type="number" min={0} max={100} dir="ltr"
                    value={l.tax} onChange={(e) => setLine(l.key, { tax: e.target.value })}
                  />
                </LineField>

                {/* على الجوال صفٌّ واحد مضغوط يجمع الإجمالي والحذف؛ و`md:contents`
                    يذيب الغلاف على الديسكتوب فيعود كلٌّ خليّةً في الشبكة. */}
                <div className="flex items-center justify-between gap-2 border-t border-border pt-1.5 md:contents md:border-0 md:pt-0">
                  <div className="md:text-end">
                    <span className="text-[11px] font-medium text-muted md:hidden">{t('line_total')}</span>{' '}
                    <span className="num text-sm font-semibold text-text md:font-normal">{formatRiyal(withTax / 100)}</span>
                  </div>
                  <Button
                    type="button" variant="ghost" size="icon" className="shrink-0 md:ms-auto"
                    aria-label={t('remove_line')} onClick={() => removeLine(l.key)}
                  >
                    <Trash2 className="h-4 w-4 text-negative" strokeWidth={1.7} />
                  </Button>
                </div>
              </div>
            );
          })}

          <p className="pt-1 text-xs leading-relaxed text-muted">{t('items_hint')}</p>
          {lines.some((l) => !l.productId) && (
            <p className="rounded border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
              {t('product_required')}
            </p>
          )}
          {lines.some((l) => !hasValidQty(l)) && (
            <p className="rounded border border-warning/30 bg-warning/10 px-3 py-2 text-xs text-warning">
              {t('qty_required')}
            </p>
          )}
        </CardContent>
      </Card>

      {/* ═══ أقسام مؤجَّلة — تظهر لتُعرَف لا لتُستعمَل ═══ */}
      {/* الخصم والشحن والتسوية — يدخل الخصمُ والشحن **تكلفة البضاعة** لا
          حساباً مستقلاً (IAS 2 للشحن، والخصم التجاري جزءٌ من ثمن الشراء). */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Percent className="h-4 w-4 text-primary" strokeWidth={1.8} />{t('s_discount')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="space-y-1.5">
              <Label htmlFor="pf-discount">{t('discount')}</Label>
              <Input
                id="pf-discount" className="num text-end" inputMode="decimal" placeholder="0"
                value={discountInput} onChange={(e) => setDiscountInput(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pf-shipping">{t('shipping')}</Label>
              <Input
                id="pf-shipping" className="num text-end" inputMode="decimal" placeholder="0"
                value={shippingInput} onChange={(e) => setShippingInput(e.target.value)}
              />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pf-adjustment">{t('adjustment')}</Label>
              <Input
                id="pf-adjustment" className="num text-end" inputMode="decimal" placeholder="0"
                value={adjustmentInput} onChange={(e) => setAdjustmentInput(e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs leading-relaxed text-muted">{t('head_amounts_hint')}</p>
        </CardContent>
      </Card>
      {/* ═══ الدفع ═══ */}
      {/* السداد الفوري **سندُ صرف مرحَّل** لا اختصارٌ داخل قيد الفاتورة:
          الفاتورة تُقيَّد على ٢١١٠ ثم يقفلها السند، فيبقى للمورّد كشفُ
          حساب حقيقي و`payment_status` صادق. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Wallet className="h-4 w-4 text-primary" strokeWidth={1.8} />{t('payment_section')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          {!isCash && (
            <label className="flex w-fit cursor-pointer items-center gap-2 text-sm text-text">
              <input
                type="checkbox" className="h-4 w-4 accent-primary"
                checked={paidNow}
                onChange={(e) => {
                  setPaidNow(e.target.checked);
                  // التأشير بلا مبلغ يعني «الكل» — وهو الحالة الغالبة.
                  if (e.target.checked && !paidInput) setPaidInput(String(totals.total / 100));
                }}
              />
              {t('paid_now')}
            </label>
          )}

          {(isCash || paidNow) && (
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="pf-paid">{t('paid_amount')}</Label>
                {isCash ? (
                  <Input id="pf-paid" className="num text-end" value={formatRiyal(totals.total / 100)} disabled />
                ) : (
                  <div className="flex items-center gap-2">
                    <Input
                      id="pf-paid" className="num min-w-0 flex-1 text-end" inputMode="decimal" placeholder="0"
                      value={paidInput} onChange={(e) => setPaidInput(e.target.value)}
                    />
                    <Button
                      type="button" variant="outline" size="sm"
                      onClick={() => setPaidInput(String(totals.total / 100))}
                    >
                      {t('pay_full')}
                    </Button>
                  </div>
                )}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="pf-method">{t('payment_method')}</Label>
                <Select id="pf-method" value={payMethod} onChange={(e) => setPayMethod(e.target.value)}>
                  <option value="cash">{t('method_cash')}</option>
                  <option value="bank">{t('method_bank')}</option>
                </Select>
              </div>
            </div>
          )}

          <p className="text-xs leading-relaxed text-muted">
            {isCash ? t('paid_cash_hint') : t('paid_hint')}
          </p>
        </CardContent>
      </Card>

      {/* ═══ الاستلام ═══ */}
      {/* حقلان إعلاميان: المخزون يدخل عند الترحيل في كل الأحوال. فصلُه
          يحتاج حساب «بضاعة بالطريق» ودورةَ استلام — وحدة مستقلة. */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Truck className="h-4 w-4 text-primary" strokeWidth={1.8} />{t('receipt_section')}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="pf-recv">{t('received_status')}</Label>
              <Select id="pf-recv" value={receivedStatus} onChange={(e) => setReceivedStatus(e.target.value)}>
                <option value="received">{t('received_full')}</option>
                <option value="partial">{t('received_partial')}</option>
                <option value="pending">{t('received_pending')}</option>
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="pf-recv-date">{t('received_date')}</Label>
              <Input
                id="pf-recv-date" type="date"
                value={receivedDate} onChange={(e) => setReceivedDate(e.target.value)}
              />
            </div>
          </div>
          <p className="text-xs leading-relaxed text-muted">{t('receipt_hint')}</p>
        </CardContent>
      </Card>

      <Card>
        {/* لا زرّ اختيارٍ في الرأس: كان يستدعي نفس `attachmentInputRef` الذي
            تستدعيه منطقة الرفع، فيَعِد بطريقتين مختلفتين للرفع ولا يوجد إلا
            واحدة. مُشغِّلٌ واحد ظاهر في كل حالة. */}
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <Paperclip className="h-4 w-4 text-primary" strokeWidth={1.8} />{t('s_attachments')}
          </CardTitle>
          <p className="mt-1 text-xs leading-relaxed text-muted">{t('s_attachments_hint')}</p>
        </CardHeader>
        <CardContent className="space-y-3">
          <Input
            ref={attachmentInputRef}
            id="purchase-attachments"
            type="file"
            multiple
            accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.jpg,.jpeg,.png,.gif,.zip"
            onChange={selectAttachments}
            // `sr-only` وحدها لا تغلب `w-full` الآتية من `Input`، فيتمدّد الحقل المخفيّ
            // بعرض الصفحة ويتجاوز حافّتها لأنه مطلق الموضع. `size-px` تحسم قياسه.
            className="sr-only size-px"
          />

          {pendingAttachments.length === 0 && storedAttachments.length === 0 ? (
            <button
              type="button"
              disabled={uploadingAttachments}
              onClick={() => attachmentInputRef.current?.click()}
              className="flex min-h-20 w-full flex-col items-center justify-center gap-1 rounded border border-dashed border-border bg-muted/15 px-3 py-3 text-center hover:border-primary hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 disabled:opacity-50"
            >
              <Paperclip className="h-5 w-5 text-muted" strokeWidth={1.6} aria-hidden />
              <span className="text-sm font-medium text-text">{t('attachments_empty')}</span>
              <span className="text-xs text-muted">{t('attachments_empty_hint')}</span>
            </button>
          ) : null}

          {pendingAttachments.length > 0 && (
            <div className="space-y-2" aria-label={t('attachments_pending')}>
              <p className="text-xs font-medium text-text">{t('attachments_pending')}</p>
              <ul className="space-y-1.5">
                {pendingAttachments.map((file, index) => (
                  <li key={`${file.name}-${file.lastModified}-${index}`} className="flex items-center gap-2 rounded border border-border px-2.5 py-2 text-sm">
                    <Paperclip className="h-4 w-4 shrink-0 text-muted" aria-hidden />
                    <span className="min-w-0 flex-1 truncate" title={file.name}>{file.name}</span>
                    <span className="num shrink-0 text-xs text-muted">{(file.size / (1024 * 1024)).toFixed(1)} MB</span>
                    <Button type="button" variant="ghost" size="icon" aria-label={`${t('remove_attachment')}: ${file.name}`} disabled={saving || uploadingAttachments} onClick={() => removePendingAttachment(index)}><Trash2 className="h-4 w-4 text-negative" /></Button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {storedAttachments.length > 0 && (
            <div className="space-y-2" aria-label={t('attachments_uploaded')}>
              <p className="text-xs font-medium text-text">{t('attachments_uploaded')}</p>
              <ul className="space-y-1.5">
                {storedAttachments.map((attachment) => (
                  <li key={attachment.id} className="flex items-center gap-2 rounded border border-border bg-muted/10 px-2.5 py-2 text-sm">
                    <Paperclip className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                    <span className="min-w-0 flex-1 truncate" title={attachment.original_name}>{attachment.original_name}</span>
                    <span className="num shrink-0 text-xs text-muted">{(attachment.size / (1024 * 1024)).toFixed(1)} MB</span>
                    <Button type="button" variant="ghost" size="icon" aria-label={`${t('remove_attachment')}: ${attachment.original_name}`} disabled={saving || uploadingAttachments} onClick={() => void removeStoredAttachment(attachment.id)}><Trash2 className="h-4 w-4 text-negative" /></Button>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* بعد اختيار ملفات تحلّ إضافةٌ صغيرة محلّ منطقة الرفع الكبيرة: القائمة
              صارت هي محتوى القسم، ومنطقةٌ متقطّعة تحتها تكرّر ما تفعله هذه. */}
          {(pendingAttachments.length > 0 || storedAttachments.length > 0) && (
            <Button
              type="button" variant="outline" size="sm"
              disabled={uploadingAttachments}
              onClick={() => attachmentInputRef.current?.click()}
            >
              <Plus className="h-4 w-4" strokeWidth={1.7} aria-hidden />{t('attachments_add_more')}
            </Button>
          )}

          {uploadingAttachments && <p className="text-xs text-muted">{t('attachments_uploading')}</p>}
        </CardContent>
      </Card>

      {/* ═══ الملاحظات ═══ */}
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-primary" strokeWidth={1.8} />{t('notes_section')}
          </CardTitle>
        </CardHeader>
        <CardContent>
          <textarea
            rows={3} value={notes} onChange={(e) => setNotes(e.target.value)}
            className="w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-primary"
          />
        </CardContent>
      </Card>

      {error && <FormAlert>{error}</FormAlert>}

      {/* العنوان صريح: النافذة المشتركة تُسمّي نفسها «إضافة طرف»، وهي هنا
          تُضيف مورّداً — والعنوان الغامض يجعل المستخدم يشكّ أنه في المكان الخطأ. */}
      <PartnerDialog
        open={newSupplier}
        onClose={() => setNewSupplier(false)}
        onSaved={() => { setNewSupplier(false); loadPartners(); }}
        defaultType="supplier"
        addTitle={t('new_supplier_title')}
      />

      {/* المنتج المُنشأ يُختار في سطره فوراً — وإلا أعاد المستخدم البحث عمّا
          أنشأه للتوّ. الاختيار يتمّ بعد إعادة الجلب لا قبلها. */}
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
              price: created.purchase_price, tax: String(created.tax_rate), unit: '',
            });
          }
        }}
      />
    </FormPage>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between">
      <span className="text-muted">{label}</span>
      <span className="num text-text">{value}</span>
    </div>
  );
}
