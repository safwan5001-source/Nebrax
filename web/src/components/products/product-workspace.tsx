'use client';

import { useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { Package, RefreshCw, Tag, Warehouse, SlidersHorizontal } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { api, ApiError } from '@/lib/api';
import { useNumberPreview } from '@/lib/use-number-preview';
import { riyalToMinor, formatRiyal, extractInclusiveTax } from '@/lib/money';
import { getSystemTaxInclusive } from '@/lib/tax';
import { productUnitForTemplate, type ProductUnitTemplate } from '@/lib/product-unit-template';
import type { Product } from './product-dialog';

interface Partner { id: string; name: string; type?: string }
interface Account { id: string; code: string; name: string; type: string; is_group: boolean }
/** عنصر قائمة مُدارة (تصنيف/علامة) — الاسم وحده يكفي للاختيار. */
interface Listed { id: string; name: string }

interface FormState {
  name: string;
  name_en: string;
  sku: string;
  barcode: string;
  type: string;
  unit: string;
  unit_template_id: string;
  default_sales_unit: string;
  default_purchase_unit: string;
  category_id: string;
  brand_id: string;
  supplier_id: string;
  description: string;
  purchase_price: string;
  sale_price: string;
  tax_rate: string;
  min_sale_price: string;
  profit_margin: string;
  discount: string;
  discount_type: string;
  sales_account_id: string;
  cogs_account_id: string;
  track_inventory: boolean;
  initial_quantity: string;
  reorder_level: string;
  tags: string;
  internal_notes: string;
  is_active: boolean;
}

const emptyForm = (): FormState => ({
  name: '', name_en: '', sku: '', barcode: '', type: 'good', unit: '',
  unit_template_id: '', default_sales_unit: '', default_purchase_unit: '',
  category_id: '', brand_id: '', supplier_id: '', description: '',
  purchase_price: '', sale_price: '', tax_rate: '15', min_sale_price: '', profit_margin: '',
  discount: '', discount_type: 'percent', sales_account_id: '', cogs_account_id: '',
  track_inventory: false, initial_quantity: '', reorder_level: '',
  tags: '', internal_notes: '', is_active: true,
});

function fromProduct(p: Product): FormState {
  return {
    name: p.name, name_en: p.name_en ?? '', sku: p.sku ?? '', barcode: p.barcode ?? '', type: p.type, unit: p.unit,
    unit_template_id: p.unit_template_id ?? '', default_sales_unit: p.default_sales_unit ?? '', default_purchase_unit: p.default_purchase_unit ?? '',
    category_id: p.category_id ?? '', brand_id: p.brand_id ?? '', supplier_id: '', description: p.description ?? '',
    purchase_price: p.purchase_price, sale_price: p.sale_price, tax_rate: String(p.tax_rate),
    min_sale_price: p.min_sale_price ?? '', profit_margin: p.profit_margin != null ? String(p.profit_margin) : '',
    discount: p.discount != null ? String(p.discount) : '', discount_type: p.discount_type ?? 'percent',
    sales_account_id: p.sales_account_id ?? '', cogs_account_id: p.cogs_account_id ?? '',
    // initial_quantity لا يُعرَض أبداً في وضع التعديل: `UpdateProductRequest` يرفضه صراحةً
    // (`prohibited`) — ليس نقصاً في الواجهة، بل توافقٌ مع عقد الخادم.
    track_inventory: p.track_inventory, initial_quantity: '', reorder_level: p.reorder_level != null ? String(p.reorder_level) : '',
    tags: p.tags ?? '', internal_notes: p.internal_notes ?? '', is_active: p.is_active,
  };
}

/** @param data الحمولة المُرسَلة إلى `POST`/`PUT` — لا يحتوي `category`/`brand` النصّيين أبداً؛ `category_id`/`brand_id` هما مصدر الحقيقة (انظر تقرير Phase 0). */
function buildPayload(form: FormState, mode: 'create' | 'edit'): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    name: form.name,
    name_en: form.name_en || null,
    sku: form.sku || null,
    barcode: form.barcode || null,
    type: form.type,
    unit: form.unit || null,
    unit_template_id: form.unit_template_id || null,
    default_sales_unit: form.default_sales_unit || null,
    default_purchase_unit: form.default_purchase_unit || null,
    category_id: form.category_id || null,
    brand_id: form.brand_id || null,
    description: form.description || null,
    purchase_price: riyalToMinor(form.purchase_price),
    sale_price: riyalToMinor(form.sale_price),
    tax_rate: Number(form.tax_rate) || 0,
    min_sale_price: form.min_sale_price !== '' ? riyalToMinor(form.min_sale_price) : null,
    profit_margin: form.profit_margin !== '' ? Number(form.profit_margin) || 0 : null,
    discount: form.discount !== '' ? Number(form.discount) || 0 : null,
    discount_type: form.discount !== '' ? form.discount_type : null,
    sales_account_id: form.sales_account_id || null,
    cogs_account_id: form.cogs_account_id || null,
    track_inventory: form.track_inventory,
    reorder_level: form.track_inventory && form.reorder_level !== '' ? Number(form.reorder_level) || 0 : null,
    tags: form.tags || null,
    internal_notes: form.internal_notes || null,
    is_active: form.is_active,
  };
  if (mode === 'create') {
    payload.supplier_id = form.supplier_id || null;
    payload.initial_quantity = form.track_inventory && form.initial_quantity !== '' ? Number(form.initial_quantity) || 0 : null;
  }

  return payload;
}

export interface ProductWorkspaceProps {
  mode: 'create' | 'edit';
  /** مطلوب في وضع التعديل — المنتج الحالي كما تُعيده `GET /products/{id}`. */
  product?: Product | null;
  /**
   * حقولٌ إضافية تُدمَج في نفس طلب `POST /products` الأول فقط (مثل `barcodes`/
   * `unit_prices` المُعلَّقة من صفحة `/products/new`) — تبقى مملوكةً بالكامل
   * لصفحة الاستدعاء؛ هذا المكوّن لا يعرف شكلها ولا يعدّلها، فقط يدمجها حرفياً
   * ضمن جسم الطلب الواحد فيحافظ على عقد «طلبٌ واحدٌ بالضبط».
   */
  extraCreatePayload?: Record<string, unknown>;
  /** يُستدعى فور نجاح أول إنشاء (POST) — قبل أي تحويل مسار. */
  onCreated?: (productId: string) => void | Promise<void>;
  /** يُستدعى فور نجاح كل تحديث لاحق (PUT). */
  onUpdated?: (productId: string) => void | Promise<void>;
  /** رابط زر الإلغاء (وضع الإنشاء فقط عادةً). */
  cancelHref?: string;
  onCancel?: () => void;
  /**
   * يُستدعى عند تغيّر الوحدات البديلة للقالب المختار (أو الوحدة الأساسية) —
   * تحتاجه صفحة `/products/new` وحدها لعرض نفس قائمة الوحدات في مُنتقي
   * الباركود المتعدّد المُعلَّق (خارج هذا المكوّن، انظر تعليق الصنف).
   */
  onAlternateUnitsChange?: (units: { name: string; factor: number }[], baseUnit: string) => void;
  /**
   * يتجاوز نصّ زرّ الحفظ الافتراضي — تستعمله `/products/new` وحدها لتُبقي
   * «إعادة محاولة النشر» ظاهراً بعد نجاح الإنشاء وفشل متابعة النشر، بدل
   * «حفظ التغييرات» الافتراضي الذي لا معنى له هنا (المنتج لم يُعرَض بعد).
   */
  saveLabel?: string;
}

/**
 * ═══════════════════════════════════════════════════════════════
 *  ProductWorkspace — مساحة عمل المنتج الموحّدة (PR-PROD-UX-1)
 * ═══════════════════════════════════════════════════════════════
 *  نطاقها اليوم: المعلومات الأساسية + التسعير القياسي + المحاسبة/الضرائب +
 *  المخزون + معلومات إضافية — الحقول المتطابقة فعلياً بين `/products/new`
 *  و`ProductDialog` سابقاً، بلا قدرة جديدة. الباركود المتعدد المُصرَّح
 *  (`ProductMultiBarcodeTable`)، الوسائط، والنشر التجاري تبقى خارج هذا
 *  المكوّن عمداً — تُدار من صفحة الاستدعاء تماماً كسابقاً حتى PR-2/PR-3/PR-4.
 *
 *  عقد «الحفظ الأول»: وضع الإنشاء يبقى مثبَّتاً (mounted) بعد نجاح `POST`
 *  الأول — لا تنقّل، لا إغلاق نافذة. `productId` المُستحدَث يُحفَظ داخلياً،
 *  وأي حفظٍ لاحق يستخدم `PUT` حصراً — لا طلب إنشاءٍ ثانٍ أبداً.
 */
export function ProductWorkspace({
  mode,
  product,
  extraCreatePayload,
  onCreated,
  onUpdated,
  cancelHref,
  onCancel,
  onAlternateUnitsChange,
  saveLabel: saveLabelOverride,
}: ProductWorkspaceProps) {
  const t = useTranslations('products');
  const tc = useTranslations('common');

  const [form, setForm] = useState<FormState>(product ? fromProduct(product) : emptyForm());
  const [persistedId, setPersistedId] = useState<string | null>(product?.id ?? null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [templates, setTemplates] = useState<ProductUnitTemplate[]>([]);
  const [categories, setCategories] = useState<Listed[]>([]);
  const [brands, setBrands] = useState<Listed[]>([]);
  const [suppliers, setSuppliers] = useState<Partner[]>([]);
  const [revenueAccounts, setRevenueAccounts] = useState<Account[]>([]);
  const [expenseAccounts, setExpenseAccounts] = useState<Account[]>([]);
  const [taxInclusive, setTaxInclusive] = useState(false);

  const { number: suggestedSku } = useNumberPreview('product', { enabled: mode === 'create' && !persistedId });

  const persisted = persistedId !== null;

  useEffect(() => {
    getSystemTaxInclusive().then(setTaxInclusive).catch(() => {});
    api<{ data: ProductUnitTemplate[] }>('/unit-templates').then((r) => setTemplates(r.data)).catch(() => {});
    api<{ data: Listed[] }>('/product-categories').then((r) => setCategories(r.data)).catch(() => {});
    api<{ data: Listed[] }>('/brands').then((r) => setBrands(r.data)).catch(() => {});
    api<{ data: Account[] }>('/accounts')
      .then((r) => {
        const leaf = r.data.filter((a) => !a.is_group);
        setRevenueAccounts(leaf.filter((a) => a.type === 'revenue'));
        setExpenseAccounts(leaf.filter((a) => a.type === 'expense'));
      })
      .catch(() => {});
    if (mode === 'create') {
      api<{ data: Partner[] }>('/partners')
        .then((r) => setSuppliers(r.data.filter((p) => p.type === 'supplier' || p.type === 'both')))
        .catch(() => {});
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode]);

  const alternateUnits = useMemo(
    () => templates.find((template) => template.id === form.unit_template_id)?.units ?? [],
    [templates, form.unit_template_id],
  );

  useEffect(() => {
    onAlternateUnitsChange?.(alternateUnits, form.unit);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [alternateUnits, form.unit]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((current) => ({ ...current, [key]: value }));
    setDirty(true);
  };

  function selectUnitTemplate(templateId: string) {
    setForm((current) => ({
      ...current,
      unit_template_id: templateId,
      unit: productUnitForTemplate(templateId, templates, current.unit),
      // تغيير القالب قد يُسقط الوحدة الافتراضية القائمة من عضويته.
      default_sales_unit: '',
      default_purchase_unit: '',
    }));
    setDirty(true);
  }

  async function submit() {
    if (!persistedId && !form.name.trim()) { setError(tc('saveFailed')); return; }
    setSaving(true);
    setError(null);
    try {
      if (!persistedId) {
        const body = { ...buildPayload(form, 'create'), ...(extraCreatePayload ?? {}) };
        const created = await api<{ data: { id: string } }>('/products', { method: 'POST', body });
        const newId = created.data.id;
        // يُحفَظ فوراً في حالة المكوّن — أي محاولة لاحقة (نجحت أم فشلت متابعتها
        // كنشرٍ أو وسائط) تستخدم `PUT` على هذا المعرّف، لا `POST` ثانياً أبداً.
        setPersistedId(newId);
        setDirty(false);
        await onCreated?.(newId);
      } else {
        const body = buildPayload(form, 'edit');
        await api(`/products/${persistedId}`, { method: 'PUT', body });
        setDirty(false);
        await onUpdated?.(persistedId);
      }
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  const saveLabel = saveLabelOverride ?? (mode === 'edit' || persisted ? t('save_changes') : t('save'));

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        {dirty && <Badge tone="warning">{t('unsaved_indicator')}</Badge>}
        <div className="ms-auto flex items-center gap-2">
          {cancelHref && (
            <Button asChild variant="ghost"><Link href={cancelHref}>{t('cancel')}</Link></Button>
          )}
          {!cancelHref && onCancel && (
            <Button type="button" variant="ghost" onClick={onCancel}>{t('cancel')}</Button>
          )}
          <Button type="button" disabled={saving || (!persistedId && !form.name.trim())} onClick={() => void submit()}>
            {saveLabel}
          </Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* المعلومات الأساسية */}
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Package className="h-4 w-4 text-primary" strokeWidth={1.8} />{t('item_details')}</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ws-name">{t('name')} <span className="text-negative">*</span></Label>
                <Input id="ws-name" value={form.name} onChange={(e) => set('name', e.target.value)} required disabled={saving} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ws-sku">{t('sku')}</Label>
                <Input id="ws-sku" dir="ltr" className="num" value={form.sku || suggestedSku} onChange={(e) => set('sku', e.target.value)} disabled={saving} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ws-name-en">{t('name_en')}</Label>
                <Input id="ws-name-en" dir="ltr" value={form.name_en} onChange={(e) => set('name_en', e.target.value)} disabled={saving} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ws-type">{t('type')}</Label>
                <Select id="ws-type" value={form.type} onChange={(e) => set('type', e.target.value)} disabled={saving}>
                  <option value="good">{t('good')}</option>
                  <option value="service">{t('service')}</option>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ws-unit-template">{t('unit_template')}</Label>
                <Select id="ws-unit-template" value={form.unit_template_id} onChange={(e) => selectUnitTemplate(e.target.value)} disabled={saving}>
                  <option value="">{t('no_unit_template')}</option>
                  {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
                </Select>
                <p className="text-xs text-muted">{t('unit_template_hint')}</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ws-unit">{t('unit')}</Label>
                <Input id="ws-unit" value={form.unit} onChange={(e) => set('unit', e.target.value)} readOnly={Boolean(form.unit_template_id)} disabled={saving} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ws-default-sales-unit">{t('default_sales_unit')}</Label>
                <Select id="ws-default-sales-unit" value={form.default_sales_unit} onChange={(e) => set('default_sales_unit', e.target.value)} disabled={saving}>
                  <option value="">{t('default_unit_base_option')}</option>
                  {alternateUnits.map((u) => <option key={u.name} value={u.name}>{u.name}</option>)}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ws-default-purchase-unit">{t('default_purchase_unit')}</Label>
                <Select id="ws-default-purchase-unit" value={form.default_purchase_unit} onChange={(e) => set('default_purchase_unit', e.target.value)} disabled={saving}>
                  <option value="">{t('default_unit_base_option')}</option>
                  {alternateUnits.map((u) => <option key={u.name} value={u.name}>{u.name}</option>)}
                </Select>
                <p className="text-xs text-muted">{t('default_units_hint')}</p>
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="ws-barcode">{t('barcode')}</Label>
                <div className="flex gap-2">
                  <Input id="ws-barcode" dir="ltr" className="num" value={form.barcode} onChange={(e) => set('barcode', e.target.value)} disabled={saving} />
                  <Button type="button" variant="outline" size="icon" aria-label={t('generate_barcode')} disabled={saving} onClick={() => set('barcode', '2' + String(Date.now()).slice(-12))}>
                    <RefreshCw className="h-4 w-4" strokeWidth={1.7} />
                  </Button>
                </div>
              </div>
              {/* الفئة/الماركة: معرّفان مرتبطان (`category_id`/`brand_id`) — مصدر الحقيقة
                  الوحيد منذ PR-PROD-UX-1؛ لا حقل نصّي حرّ بعد اليوم (Phase 0). */}
              <div className="space-y-1.5">
                <Label htmlFor="ws-category">{t('category')}</Label>
                <Select id="ws-category" value={form.category_id} onChange={(e) => set('category_id', e.target.value)} disabled={saving}>
                  <option value="">{t('unclassified')}</option>
                  {categories.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ws-brand">{t('brand')}</Label>
                <Select id="ws-brand" value={form.brand_id} onChange={(e) => set('brand_id', e.target.value)} disabled={saving}>
                  <option value="">{t('unclassified')}</option>
                  {brands.map((b) => <option key={b.id} value={b.id}>{b.name}</option>)}
                </Select>
              </div>
              {mode === 'create' && suppliers.length > 0 && (
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="ws-supplier">{t('supplier')}</Label>
                  <Select id="ws-supplier" value={form.supplier_id} onChange={(e) => set('supplier_id', e.target.value)} disabled={saving}>
                    <option value="">{t('no_supplier')}</option>
                    {suppliers.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
                  </Select>
                </div>
              )}
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="ws-description">{t('description')}</Label>
                <textarea id="ws-description" rows={3} value={form.description} onChange={(e) => set('description', e.target.value)} disabled={saving} className="min-h-16 w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none placeholder:text-muted focus:border-primary disabled:opacity-50" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* التسعير والضرائب والمحاسبة */}
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Tag className="h-4 w-4 text-primary" strokeWidth={1.8} />{t('pricing_details')}</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="ws-purchase-price">{t('purchase_price')}</Label>
                <Input id="ws-purchase-price" inputMode="decimal" className="num text-end" placeholder="0.00" value={form.purchase_price} onChange={(e) => set('purchase_price', e.target.value)} disabled={saving} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ws-sale-price">{t('sale_price')}</Label>
                <Input id="ws-sale-price" inputMode="decimal" className="num text-end" placeholder="0.00" value={form.sale_price} onChange={(e) => set('sale_price', e.target.value)} required disabled={saving} />
                {(() => {
                  const pm = riyalToMinor(form.sale_price);
                  const rate = Number(form.tax_rate) || 0;
                  if (!Number.isFinite(pm) || pm <= 0 || rate <= 0) return null;
                  const other = taxInclusive ? pm - extractInclusiveTax(pm, rate) : pm + Math.round((pm * rate) / 100);
                  return (
                    <p className="text-[11px] text-muted">
                      {t(taxInclusive ? 'price_hint_incl' : 'price_hint_excl', { amount: formatRiyal(other / 100) })}
                    </p>
                  );
                })()}
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ws-tax-rate">{t('tax_rate')}</Label>
                <Input id="ws-tax-rate" type="number" min={0} max={100} dir="ltr" className="num text-end" value={form.tax_rate} onChange={(e) => set('tax_rate', e.target.value)} disabled={saving} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ws-min-sale">{t('min_sale_price')}</Label>
                <Input id="ws-min-sale" inputMode="decimal" className="num text-end" placeholder="0.00" value={form.min_sale_price} onChange={(e) => set('min_sale_price', e.target.value)} disabled={saving} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ws-margin">{t('profit_margin')}</Label>
                <Input id="ws-margin" type="number" min={0} dir="ltr" className="num text-end" value={form.profit_margin} onChange={(e) => set('profit_margin', e.target.value)} disabled={saving} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="ws-discount">{t('discount')}</Label>
                <div className="flex gap-2">
                  <Input id="ws-discount" type="number" min={0} dir="ltr" className="num text-end" value={form.discount} onChange={(e) => set('discount', e.target.value)} disabled={saving} />
                  <Select className="w-24" value={form.discount_type} onChange={(e) => set('discount_type', e.target.value)} disabled={saving}>
                    <option value="percent">%</option>
                    <option value="amount">﷼</option>
                  </Select>
                </div>
              </div>
              {revenueAccounts.length > 0 && (
                <div className="space-y-1.5">
                  <Label htmlFor="ws-sales-acc">{t('sales_account')}</Label>
                  <Select id="ws-sales-acc" value={form.sales_account_id} onChange={(e) => set('sales_account_id', e.target.value)} disabled={saving}>
                    <option value="">{t('default_account')}</option>
                    {revenueAccounts.map((a) => (<option key={a.id} value={a.id}>{a.code} — {a.name}</option>))}
                  </Select>
                </div>
              )}
              {expenseAccounts.length > 0 && (
                <div className="space-y-1.5">
                  <Label htmlFor="ws-cogs-acc">{t('cogs_account')}</Label>
                  <Select id="ws-cogs-acc" value={form.cogs_account_id} onChange={(e) => set('cogs_account_id', e.target.value)} disabled={saving}>
                    <option value="">{t('default_account')}</option>
                    {expenseAccounts.map((a) => (<option key={a.id} value={a.id}>{a.code} — {a.name}</option>))}
                  </Select>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* المخزون */}
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Warehouse className="h-4 w-4 text-primary" strokeWidth={1.8} />{t('inventory_mgmt')}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <label className="flex items-center gap-2 text-sm text-text">
              <input type="checkbox" checked={form.track_inventory} onChange={(e) => set('track_inventory', e.target.checked)} disabled={saving} />
              {t('track_inventory')}
            </label>
            {form.track_inventory && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                {mode === 'create' && (
                  <div className="space-y-1.5">
                    <Label htmlFor="ws-initial-qty">{t('initial_quantity')}</Label>
                    <Input id="ws-initial-qty" type="number" min={0} dir="ltr" className="num text-end" placeholder="0" value={form.initial_quantity} onChange={(e) => set('initial_quantity', e.target.value)} disabled={saving} />
                    <p className="text-[11px] text-muted">{t('initial_quantity_hint')}</p>
                  </div>
                )}
                <div className="space-y-1.5">
                  <Label htmlFor="ws-reorder">{t('reorder_level')}</Label>
                  <Input id="ws-reorder" type="number" min={0} dir="ltr" className="num text-end" placeholder="0" value={form.reorder_level} onChange={(e) => set('reorder_level', e.target.value)} disabled={saving} />
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* معلومات إضافية */}
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><SlidersHorizontal className="h-4 w-4 text-primary" strokeWidth={1.8} />{t('more_options')}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="ws-tags">{t('tags')}</Label>
              <Input id="ws-tags" placeholder={t('tags_hint')} value={form.tags} onChange={(e) => set('tags', e.target.value)} disabled={saving} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="ws-notes">{t('internal_notes')}</Label>
              <textarea id="ws-notes" rows={2} value={form.internal_notes} onChange={(e) => set('internal_notes', e.target.value)} disabled={saving} className="w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-primary disabled:opacity-50" />
            </div>
            <label className="flex items-center gap-2 text-sm text-text">
              <input type="checkbox" checked={form.is_active} onChange={(e) => set('is_active', e.target.checked)} disabled={saving} />
              {t('active')}
            </label>
          </CardContent>
        </Card>
      </div>

      {error && <p role="alert" className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}
    </div>
  );
}
