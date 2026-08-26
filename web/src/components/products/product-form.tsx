'use client';

import * as React from 'react';
import { useTranslations } from 'next-intl';
import { Boxes, Coins, Image as ImageIcon, Package, ShoppingCart, StickyNote } from 'lucide-react';
import { FieldGrid, FieldSpan, FormSection, ToggleField } from '@/components/nebrax';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { api } from '@/lib/api';
import { extractInclusiveTax, formatRiyal, riyalToMinor, SAUDI_RIYAL_SYMBOL } from '@/lib/money';
import { getSystemTaxInclusive } from '@/lib/tax';
import { useNumberPreview } from '@/lib/use-number-preview';
import { productUnitForTemplate, type ProductUnitTemplate } from '@/lib/product-unit-template';
import { ProductMediaSection, type PendingImage } from './product-media-section';

/**
 * نموذج بيانات المنتج — مشترك بين الإنشاء والتعديل، على نمط النموذج المعتمد
 * (المرحلة ٣): أقسامٌ بالمعنى لا بطاقتان متوازيتان، وشريط إجراءات واحد في الصفحة.
 *
 * الترتيب من واقع إدخال صنفٍ جديد: من هو (الهوية) ← بكم يُباع ← بكم يُشترى ←
 * أيُتتبَّع مخزونه ← صوره ← ما يبقى من بيانات ثانوية.
 */
export interface ProductFormValues {
  name: string; name_en: string; sku: string; barcode: string; type: string;
  unit: string; unit_template_id: string;
  category_id: string; brand_id: string;
  sale_price: string; purchase_price: string; tax_rate: string;
  min_sale_price: string; profit_margin: string; discount: string; discount_type: string;
  supplier_id: string; sales_account_id: string; cogs_account_id: string;
  track_inventory: boolean; initial_quantity: string; reorder_level: string;
  description: string; tags: string; internal_notes: string;
  is_active: boolean;
}

export const EMPTY_PRODUCT_FORM: ProductFormValues = {
  name: '', name_en: '', sku: '', barcode: '', type: 'good',
  unit: '', unit_template_id: '',
  category_id: '', brand_id: '',
  sale_price: '', purchase_price: '', tax_rate: '15',
  min_sale_price: '', profit_margin: '', discount: '', discount_type: 'percent',
  supplier_id: '', sales_account_id: '', cogs_account_id: '',
  track_inventory: false, initial_quantity: '', reorder_level: '',
  description: '', tags: '', internal_notes: '',
  is_active: true,
};

/** شكل المنتج كما يعيده الـ API (المبالغ بالريال كنصّ). */
export interface ProductApi {
  id: string;
  name: string; name_en: string | null; sku: string | null; barcode: string | null; type: string;
  unit: string; unit_template_id: string | null;
  category: string | null; brand: string | null; category_id: string | null; brand_id: string | null;
  sale_price: string; purchase_price: string; tax_rate: number;
  min_sale_price: string | null; profit_margin: number | null;
  discount: number | null; discount_type: string | null;
  supplier_id: string | null; sales_account_id: string | null; cogs_account_id: string | null;
  track_inventory: boolean; reorder_level: number | null;
  quantity_on_hand: number; avg_cost: string;
  description: string | null; tags: string | null; internal_notes: string | null;
  is_active: boolean;
  units?: Array<{ name: string; factor: number }>;
}

export function productFormFromApi(product: ProductApi): ProductFormValues {
  return {
    ...EMPTY_PRODUCT_FORM,
    name: product.name ?? '',
    name_en: product.name_en ?? '',
    sku: product.sku ?? '',
    barcode: product.barcode ?? '',
    type: product.type ?? 'good',
    unit: product.unit ?? '',
    unit_template_id: product.unit_template_id ?? '',
    category_id: product.category_id ?? '',
    brand_id: product.brand_id ?? '',
    sale_price: product.sale_price ?? '',
    purchase_price: product.purchase_price ?? '',
    tax_rate: String(product.tax_rate ?? 15),
    min_sale_price: product.min_sale_price ?? '',
    profit_margin: product.profit_margin != null ? String(product.profit_margin) : '',
    discount: product.discount != null ? String(product.discount) : '',
    discount_type: product.discount_type ?? 'percent',
    supplier_id: product.supplier_id ?? '',
    sales_account_id: product.sales_account_id ?? '',
    cogs_account_id: product.cogs_account_id ?? '',
    track_inventory: product.track_inventory === true,
    reorder_level: product.reorder_level != null ? String(product.reorder_level) : '',
    description: product.description ?? '',
    tags: product.tags ?? '',
    internal_notes: product.internal_notes ?? '',
    is_active: product.is_active !== false,
  };
}

/**
 * يحوّل النموذج إلى جسم الطلب.
 *
 * **`initial_quantity` عند الإنشاء وحده**: ليست عموداً بل فعلٌ يولّد قيد رصيد
 * افتتاحي وحركة مخزون، و`UpdateProductRequest` يرفضها بـ`prohibited` صراحةً.
 *
 * **`sku` فارغاً تعني «ولّده الخادم»**: `ProductController::store` يخصّص الرقم
 * التالي تحت القفل نفسه، فإرسال المعاينة كقيمة كان سيثبّت رقماً غير محجوز.
 */
export function productFormToPayload(form: ProductFormValues, mode: 'create' | 'edit'): Record<string, unknown> {
  const orNull = (value: string) => (value.trim() === '' ? null : value.trim());
  const intOrNull = (value: string) => (value.trim() === '' ? null : Number(value) || 0);

  const payload: Record<string, unknown> = {
    name: form.name.trim(),
    name_en: orNull(form.name_en),
    sku: orNull(form.sku),
    barcode: orNull(form.barcode),
    type: form.type,
    unit: orNull(form.unit),
    unit_template_id: form.unit_template_id || null,
    category_id: form.category_id || null,
    brand_id: form.brand_id || null,
    sale_price: riyalToMinor(form.sale_price),
    purchase_price: riyalToMinor(form.purchase_price),
    tax_rate: Number(form.tax_rate) || 0,
    min_sale_price: form.min_sale_price.trim() !== '' ? riyalToMinor(form.min_sale_price) : null,
    profit_margin: intOrNull(form.profit_margin),
    discount: intOrNull(form.discount),
    discount_type: form.discount.trim() !== '' ? form.discount_type : null,
    supplier_id: form.supplier_id || null,
    sales_account_id: form.sales_account_id || null,
    cogs_account_id: form.cogs_account_id || null,
    reorder_level: form.track_inventory ? intOrNull(form.reorder_level) : null,
    description: orNull(form.description),
    tags: orNull(form.tags),
    internal_notes: orNull(form.internal_notes),
    track_inventory: form.track_inventory,
    is_active: form.is_active,
  };

  if (mode === 'create') {
    payload.initial_quantity = form.track_inventory ? intOrNull(form.initial_quantity) : null;
  }

  return payload;
}

/** الاسم مطلوب، وسعر البيع مطلوب في `StoreProductRequest` — فيُحرَسان هنا لا بعد الرفض. */
export function canSaveProduct(form: ProductFormValues): boolean {
  return form.name.trim() !== '' && Number.isFinite(riyalToMinor(form.sale_price));
}

interface Listed { id: string; name: string }
interface Account { id: string; code: string; name: string; type: string; is_group: boolean }
interface SupplierOption { id: string; name: string; type?: string }

export function ProductForm({
  form,
  onChange,
  mode,
  productId = null,
  pendingImages,
  onPendingImagesChange,
  onMediaError,
  disabled,
}: {
  form: ProductFormValues;
  onChange: <K extends keyof ProductFormValues>(key: K, value: ProductFormValues[K]) => void;
  mode: 'create' | 'edit';
  productId?: string | null;
  pendingImages: PendingImage[];
  onPendingImagesChange: (images: PendingImage[]) => void;
  onMediaError: (message: string | null) => void;
  disabled?: boolean;
}) {
  const t = useTranslations('products');
  const [categories, setCategories] = React.useState<Listed[]>([]);
  const [brands, setBrands] = React.useState<Listed[]>([]);
  const [templates, setTemplates] = React.useState<ProductUnitTemplate[]>([]);
  const [suppliers, setSuppliers] = React.useState<SupplierOption[]>([]);
  const [revenueAccounts, setRevenueAccounts] = React.useState<Account[]>([]);
  const [expenseAccounts, setExpenseAccounts] = React.useState<Account[]>([]);
  const [taxInclusive, setTaxInclusive] = React.useState(false);
  // معاينةٌ غير محجوزة: نائبٌ في الحقل لا قيمة فيه — الخادم يخصّص الرقم النهائي
  // تحت القفل عند الحفظ، فعرضُه كقيمة كان يَعِد برقمٍ قد يخصّص غيره.
  const { number: suggestedSku } = useNumberPreview('product', { enabled: mode === 'create' });

  React.useEffect(() => {
    getSystemTaxInclusive().then(setTaxInclusive).catch(() => {});
    api<{ data: Listed[] }>('/product-categories').then((r) => setCategories(r.data)).catch(() => {});
    api<{ data: Listed[] }>('/brands').then((r) => setBrands(r.data)).catch(() => {});
    api<{ data: ProductUnitTemplate[] }>('/unit-templates').then((r) => setTemplates(r.data)).catch(() => {});
    // الخادم يدعم `?type=supplier` (`whereIn` مع `both`) — فلترةٌ في مكانها لا بعد الجلب.
    api<{ data: SupplierOption[] }>('/partners?type=supplier').then((r) => setSuppliers(r.data)).catch(() => {});
    api<{ data: Account[] }>('/accounts')
      .then((r) => {
        const leaf = r.data.filter((account) => !account.is_group);
        setRevenueAccounts(leaf.filter((account) => account.type === 'revenue'));
        setExpenseAccounts(leaf.filter((account) => account.type === 'expense'));
      })
      .catch(() => {});
  }, []);

  function selectTemplate(templateId: string) {
    onChange('unit_template_id', templateId);
    onChange('unit', productUnitForTemplate(templateId, templates, form.unit));
  }

  // مكمّل السعر حسب وضع الضريبة في إعدادات النظام: يوضّح دلالة الرقم المكتوب.
  const priceHint = (() => {
    const minor = riyalToMinor(form.sale_price);
    const rate = Number(form.tax_rate) || 0;
    if (!Number.isFinite(minor) || minor <= 0 || rate <= 0) return null;
    const other = taxInclusive ? minor - extractInclusiveTax(minor, rate) : minor + Math.round((minor * rate) / 100);
    return t(taxInclusive ? 'price_hint_incl' : 'price_hint_excl', { amount: formatRiyal(other / 100) });
  })();

  const templateUnits = templates.find((template) => template.id === form.unit_template_id)?.units ?? [];

  return (
    <>
      <FormSection title={t('section_identity')} icon={Package}>
        <FieldGrid>
          <FieldSpan>
            <Label htmlFor="product-name">{t('name')} <span className="text-negative">*</span></Label>
            <Input
              id="product-name" className="mt-1.5" value={form.name} required disabled={disabled}
              onChange={(event) => onChange('name', event.target.value)}
            />
          </FieldSpan>
          <div>
            <Label htmlFor="product-name-en">{t('name_en')}</Label>
            <Input
              id="product-name-en" className="mt-1.5" dir="ltr" value={form.name_en} disabled={disabled}
              onChange={(event) => onChange('name_en', event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="product-type">{t('type')}</Label>
            <Select
              id="product-type" className="mt-1.5" value={form.type} disabled={disabled}
              onChange={(event) => onChange('type', event.target.value)}
            >
              <option value="good">{t('good')}</option>
              <option value="service">{t('service')}</option>
            </Select>
          </div>
          {/* الرمز والباركود يُمسحان ضوئياً ويُقرآن رقماً: LTR وخط Mono دائماً،
              مهما كان اتجاه الصفحة. */}
          <div>
            <Label htmlFor="product-sku">{t('sku')}</Label>
            <Input
              id="product-sku" className="num mt-1.5" dir="ltr" inputMode="text" value={form.sku} disabled={disabled}
              placeholder={suggestedSku || undefined} aria-describedby="product-sku-hint"
              onChange={(event) => onChange('sku', event.target.value)}
            />
            <p id="product-sku-hint" className="mt-1 text-[11px] leading-relaxed text-muted">{t('sku_auto_hint')}</p>
          </div>
          <div>
            <Label htmlFor="product-barcode">{t('barcode')}</Label>
            <Input
              id="product-barcode" className="num mt-1.5" dir="ltr" inputMode="numeric" value={form.barcode} disabled={disabled}
              onChange={(event) => onChange('barcode', event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="product-category">{t('category')}</Label>
            <Select
              id="product-category" className="mt-1.5" value={form.category_id} disabled={disabled}
              onChange={(event) => onChange('category_id', event.target.value)}
            >
              <option value="">{t('unclassified')}</option>
              {categories.map((category) => <option key={category.id} value={category.id}>{category.name}</option>)}
            </Select>
          </div>
          <div>
            <Label htmlFor="product-brand">{t('brand')}</Label>
            <Select
              id="product-brand" className="mt-1.5" value={form.brand_id} disabled={disabled}
              onChange={(event) => onChange('brand_id', event.target.value)}
            >
              <option value="">{t('unclassified')}</option>
              {brands.map((brand) => <option key={brand.id} value={brand.id}>{brand.name}</option>)}
            </Select>
          </div>
          <FieldSpan>
            <ToggleField
              id="product-active"
              label={t('active')}
              hint={t('active_hint')}
              checked={form.is_active}
              disabled={disabled}
              onCheckedChange={(value) => onChange('is_active', value)}
            />
          </FieldSpan>
        </FieldGrid>
      </FormSection>

      <FormSection title={t('section_sales')} icon={Coins}>
        <FieldGrid columns={3}>
          <div>
            <Label htmlFor="product-sale-price">{t('sale_price')} <span className="text-negative">*</span></Label>
            <Input
              id="product-sale-price" className="num mt-1.5 text-end" inputMode="decimal" dir="ltr"
              placeholder="0.00" value={form.sale_price} disabled={disabled} required
              onChange={(event) => onChange('sale_price', event.target.value)}
            />
            {priceHint ? <p className="mt-1 text-[11px] leading-relaxed text-muted">{priceHint}</p> : null}
          </div>
          <div>
            <Label htmlFor="product-tax-rate">{t('tax_rate')}</Label>
            <Input
              id="product-tax-rate" className="num mt-1.5 text-end" type="number" min={0} max={100} dir="ltr"
              value={form.tax_rate} disabled={disabled}
              onChange={(event) => onChange('tax_rate', event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="product-min-price">{t('min_sale_price')}</Label>
            <Input
              id="product-min-price" className="num mt-1.5 text-end" inputMode="decimal" dir="ltr"
              placeholder="0.00" value={form.min_sale_price} disabled={disabled}
              aria-describedby="product-min-price-hint"
              onChange={(event) => onChange('min_sale_price', event.target.value)}
            />
            <p id="product-min-price-hint" className="mt-1 text-[11px] leading-relaxed text-muted">{t('min_sale_price_hint')}</p>
          </div>
          <div>
            <Label htmlFor="product-margin">{t('profit_margin')}</Label>
            <Input
              id="product-margin" className="num mt-1.5 text-end" type="number" min={0} dir="ltr"
              value={form.profit_margin} disabled={disabled}
              onChange={(event) => onChange('profit_margin', event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="product-discount">{t('discount')}</Label>
            <div className="mt-1.5 flex gap-2">
              <Input
                id="product-discount" className="num text-end" type="number" min={0} dir="ltr"
                value={form.discount} disabled={disabled}
                onChange={(event) => onChange('discount', event.target.value)}
              />
              {/* منتقي وحدة الخصم: كان بلا `id` ولا تسمية، وخيارُه الثاني الرمز
                  القديم `﷼` حرفياً. الرمز الآن من الثابت المركزي وحده. */}
              <Label htmlFor="product-discount-type" className="sr-only">{t('discount_type')}</Label>
              <Select
                id="product-discount-type" className="w-24 shrink-0" value={form.discount_type} disabled={disabled}
                onChange={(event) => onChange('discount_type', event.target.value)}
              >
                <option value="percent">%</option>
                <option value="amount">{SAUDI_RIYAL_SYMBOL}</option>
              </Select>
            </div>
          </div>
          <div>
            <Label htmlFor="product-sales-account">{t('sales_account')}</Label>
            <Select
              id="product-sales-account" className="mt-1.5" value={form.sales_account_id} disabled={disabled}
              onChange={(event) => onChange('sales_account_id', event.target.value)}
            >
              <option value="">{t('default_account')}</option>
              {revenueAccounts.map((account) => (
                <option key={account.id} value={account.id}>{account.code} — {account.name}</option>
              ))}
            </Select>
          </div>
        </FieldGrid>
      </FormSection>

      <FormSection title={t('section_purchases')} icon={ShoppingCart}>
        <FieldGrid columns={3}>
          <div>
            <Label htmlFor="product-purchase-price">{t('purchase_price')}</Label>
            <Input
              id="product-purchase-price" className="num mt-1.5 text-end" inputMode="decimal" dir="ltr"
              placeholder="0.00" value={form.purchase_price} disabled={disabled}
              onChange={(event) => onChange('purchase_price', event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor="product-supplier">{t('supplier')}</Label>
            <Select
              id="product-supplier" className="mt-1.5" value={form.supplier_id} disabled={disabled}
              onChange={(event) => onChange('supplier_id', event.target.value)}
            >
              <option value="">{t('no_supplier')}</option>
              {suppliers.map((supplier) => <option key={supplier.id} value={supplier.id}>{supplier.name}</option>)}
            </Select>
          </div>
          <div>
            <Label htmlFor="product-cogs-account">{t('cogs_account')}</Label>
            <Select
              id="product-cogs-account" className="mt-1.5" value={form.cogs_account_id} disabled={disabled}
              onChange={(event) => onChange('cogs_account_id', event.target.value)}
            >
              <option value="">{t('default_account')}</option>
              {expenseAccounts.map((account) => (
                <option key={account.id} value={account.id}>{account.code} — {account.name}</option>
              ))}
            </Select>
          </div>
        </FieldGrid>
      </FormSection>

      <FormSection title={t('section_inventory')} icon={Boxes}>
        <div className="space-y-4">
          <ToggleField
            id="product-track"
            label={t('track_inventory')}
            hint={t('track_inventory_hint')}
            checked={form.track_inventory}
            disabled={disabled}
            onCheckedChange={(value) => onChange('track_inventory', value)}
          />

          <FieldGrid>
            <div>
              <Label htmlFor="product-unit-template">{t('unit_template')}</Label>
              <Select
                id="product-unit-template" className="mt-1.5" value={form.unit_template_id} disabled={disabled}
                onChange={(event) => selectTemplate(event.target.value)}
                aria-describedby="product-unit-template-hint"
              >
                <option value="">{t('no_unit_template')}</option>
                {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
              </Select>
              <p id="product-unit-template-hint" className="mt-1 text-[11px] leading-relaxed text-muted">{t('unit_template_hint')}</p>
            </div>
            <div>
              <Label htmlFor="product-unit">{t('unit')}</Label>
              <Input
                id="product-unit" className="mt-1.5" value={form.unit}
                readOnly={Boolean(form.unit_template_id)} disabled={disabled}
                onChange={(event) => onChange('unit', event.target.value)}
              />
              {/* الوحدات البديلة تُدار في قالب الوحدات وحده — عرضها هنا للقراءة
                  يمنع تكرار مصدر الحقيقة ويشرح ما ورثه المنتج من القالب. */}
              {templateUnits.length > 0 ? (
                <p className="num mt-1 text-[11px] leading-relaxed text-muted">
                  {t('template_units_readonly', {
                    units: templateUnits.map((unit) => `${unit.name} ×${unit.factor}`).join(' · '),
                  })}
                </p>
              ) : null}
            </div>

            {form.track_inventory ? (
              <>
                {mode === 'create' ? (
                  <div>
                    <Label htmlFor="product-initial-qty">{t('initial_quantity')}</Label>
                    <Input
                      id="product-initial-qty" className="num mt-1.5 text-end" type="number" min={0} dir="ltr"
                      placeholder="0" value={form.initial_quantity} disabled={disabled}
                      aria-describedby="product-initial-qty-hint"
                      onChange={(event) => onChange('initial_quantity', event.target.value)}
                    />
                    <p id="product-initial-qty-hint" className="mt-1 text-[11px] leading-relaxed text-muted">{t('initial_quantity_hint')}</p>
                  </div>
                ) : (
                  <FieldSpan>
                    <p className="rounded bg-primary-soft px-3 py-2 text-[11px] leading-relaxed text-primary">
                      {t('initial_quantity_locked')}
                    </p>
                  </FieldSpan>
                )}
                <div>
                  <Label htmlFor="product-reorder">{t('reorder_level')}</Label>
                  <Input
                    id="product-reorder" className="num mt-1.5 text-end" type="number" min={0} dir="ltr"
                    placeholder="0" value={form.reorder_level} disabled={disabled}
                    onChange={(event) => onChange('reorder_level', event.target.value)}
                  />
                </div>
              </>
            ) : null}
          </FieldGrid>
        </div>
      </FormSection>

      <FormSection title={t('product_media')} icon={ImageIcon}>
        <ProductMediaSection
          productId={productId}
          pending={pendingImages}
          onPendingChange={onPendingImagesChange}
          onError={onMediaError}
          disabled={disabled}
        />
      </FormSection>

      <FormSection title={t('section_more')} icon={StickyNote}>
        <FieldGrid>
          <FieldSpan>
            <Label htmlFor="product-description">{t('description')}</Label>
            <Textarea
              id="product-description" className="mt-1.5 min-h-16" rows={3} value={form.description} disabled={disabled}
              onChange={(event) => onChange('description', event.target.value)}
            />
          </FieldSpan>
          <FieldSpan>
            <Label htmlFor="product-tags">{t('tags')}</Label>
            <Input
              id="product-tags" className="mt-1.5" placeholder={t('tags_hint')} value={form.tags} disabled={disabled}
              onChange={(event) => onChange('tags', event.target.value)}
            />
          </FieldSpan>
          <FieldSpan>
            <Label htmlFor="product-notes">{t('internal_notes')}</Label>
            <Textarea
              id="product-notes" className="mt-1.5 min-h-16" rows={2} value={form.internal_notes} disabled={disabled}
              onChange={(event) => onChange('internal_notes', event.target.value)}
            />
          </FieldSpan>
        </FieldGrid>
      </FormSection>
    </>
  );
}
