'use client';

import Link from 'next/link';
import { ChangeEvent, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight, Package, Tag, Warehouse, SlidersHorizontal, RefreshCw, Trash2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { useNumberPreview } from '@/lib/use-number-preview';
import { riyalToMinor, formatRiyal, extractInclusiveTax } from '@/lib/money';
import { getSystemTaxInclusive } from '@/lib/tax';
import { productUnitForTemplate, type ProductUnitTemplate } from '@/lib/product-unit-template';

interface Partner { id: string; name: string; type?: string }
interface Account { id: string; code: string; name: string; type: string; is_group: boolean }
interface SelectedProductImage { file: File; previewUrl: string }

const MAX_PRODUCT_IMAGES = 8;
const MAX_PRODUCT_IMAGE_SIZE = 5 * 1024 * 1024;
const PRODUCT_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

export default function NewProductPage() {
  const t = useTranslations('products');
  const tc = useTranslations('common');
  const router = useRouter();
  const { success, error: toastError } = useToast();

  const [name, setName] = useState('');
  const [nameEn, setNameEn] = useState('');
  const [sku, setSku] = useState('');
  const [barcode, setBarcode] = useState('');
  const [type, setType] = useState('good');
  const [unit, setUnit] = useState('');
  const [unitTemplateId, setUnitTemplateId] = useState('');
  const [templates, setTemplates] = useState<ProductUnitTemplate[]>([]);
  const [salePrice, setSalePrice] = useState('');
  const [purchasePrice, setPurchasePrice] = useState('');
  const [taxRate, setTaxRate] = useState('15');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [brand, setBrand] = useState('');
  const [reorderLevel, setReorderLevel] = useState('');
  const [initialQty, setInitialQty] = useState('');
  const [trackInventory, setTrackInventory] = useState(false);
  const [isActive, setIsActive] = useState(true);
  const [suppliers, setSuppliers] = useState<Partner[]>([]);
  const [supplierId, setSupplierId] = useState('');
  const [minSalePrice, setMinSalePrice] = useState('');
  const [discount, setDiscount] = useState('');
  const [discountType, setDiscountType] = useState('percent');
  const [profitMargin, setProfitMargin] = useState('');
  const [tags, setTags] = useState('');
  const [internalNotes, setInternalNotes] = useState('');
  const [revenueAccounts, setRevenueAccounts] = useState<Account[]>([]);
  const [expenseAccounts, setExpenseAccounts] = useState<Account[]>([]);
  const [salesAccountId, setSalesAccountId] = useState('');
  const [cogsAccountId, setCogsAccountId] = useState('');
  const [taxInclusive, setTaxInclusive] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [productImages, setProductImages] = useState<SelectedProductImage[]>([]);
  const { number: suggestedSku } = useNumberPreview('product');
  const productImageUrls = useRef<string[]>([]);

  useEffect(() => {
    getSystemTaxInclusive().then(setTaxInclusive).catch(() => {});
    api<{ data: Partner[] }>('/partners')
      .then((r) => setSuppliers(r.data.filter((p) => p.type === 'supplier' || p.type === 'both')))
      .catch(() => {});
    api<{ data: ProductUnitTemplate[] }>('/unit-templates').then((r) => setTemplates(r.data)).catch(() => {});
    api<{ data: Account[] }>('/accounts')
      .then((r) => {
        const leaf = r.data.filter((a) => !a.is_group);
        setRevenueAccounts(leaf.filter((a) => a.type === 'revenue'));
        setExpenseAccounts(leaf.filter((a) => a.type === 'expense'));
      })
      .catch(() => {});
  }, []);

  useEffect(() => () => {
    productImageUrls.current.forEach((previewUrl) => URL.revokeObjectURL(previewUrl));
  }, []);

  function selectUnitTemplate(templateId: string) {
    setUnitTemplateId(templateId);
    setUnit((currentUnit) => productUnitForTemplate(templateId, templates, currentUnit));
  }

  function selectProductImages(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    if (files.length === 0) return;

    if (files.length + productImages.length > MAX_PRODUCT_IMAGES) {
      setError(t('media_limit_reached'));
      return;
    }

    if (files.some((file) => !PRODUCT_IMAGE_TYPES.includes(file.type) || file.size > MAX_PRODUCT_IMAGE_SIZE)) {
      setError(t('media_invalid_file'));
      return;
    }

    const selected = files.map((file) => {
      const previewUrl = URL.createObjectURL(file);
      productImageUrls.current.push(previewUrl);
      return { file, previewUrl };
    });
    setProductImages((current) => [...current, ...selected]);
    setError(null);
  }

  function removeProductImage(previewUrl: string) {
    URL.revokeObjectURL(previewUrl);
    productImageUrls.current = productImageUrls.current.filter((url) => url !== previewUrl);
    setProductImages((current) => current.filter((image) => image.previewUrl !== previewUrl));
  }

  async function submit() {
    if (!name.trim()) { setError(tc('saveFailed')); return; }
    setSaving(true);
    setError(null);
    try {
      const created = await api<{ data: { id: string } }>('/products', {
        method: 'POST',
        body: {
          name,
          name_en: nameEn || null,
          sku: sku || null,
          barcode: barcode || null,
          type,
          unit: unit || null,
          unit_template_id: unitTemplateId || null,
          sale_price: riyalToMinor(salePrice),
          purchase_price: riyalToMinor(purchasePrice),
          tax_rate: Number(taxRate) || 0,
          description: description || null,
          category: category || null,
          brand: brand || null,
          reorder_level: trackInventory && reorderLevel !== '' ? Number(reorderLevel) || 0 : null,
          initial_quantity: trackInventory && initialQty !== '' ? Number(initialQty) || 0 : null,
          supplier_id: supplierId || null,
          sales_account_id: salesAccountId || null,
          cogs_account_id: cogsAccountId || null,
          min_sale_price: minSalePrice !== '' ? riyalToMinor(minSalePrice) : null,
          discount: discount !== '' ? Number(discount) || 0 : null,
          discount_type: discount !== '' ? discountType : null,
          profit_margin: profitMargin !== '' ? Number(profitMargin) || 0 : null,
          tags: tags || null,
          internal_notes: internalNotes || null,
          track_inventory: trackInventory,
          is_active: isActive,
        },
      });

      if (productImages.length > 0) {
        const mediaBody = new FormData();
        productImages.forEach(({ file }) => mediaBody.append('media[]', file));
        try {
          await api(`/products/${created.data.id}/media`, { method: 'POST', body: mediaBody });
        } catch {
          toastError(t('media_upload_failed_after_create'));
          router.push(`/products/${created.data.id}`);
          return;
        }
      }

      success(tc('created'));
      router.push('/products');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="space-y-5">
      {/* شريط الإجراءات */}
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="icon" aria-label={t('back')}><Link href='/products'>
          <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
        </Link></Button>
        <h1 className="text-xl font-semibold text-text">{t('new_title')}</h1>
        <div className="ms-auto flex items-center gap-2">
          <Button asChild variant="ghost"><Link href='/products'>{t('cancel')}</Link></Button>
          <Button disabled={saving || !name.trim()} onClick={submit}>{t('save')}</Button>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-5 lg:grid-cols-2">
        {/* تفاصيل البند */}
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Package className="h-4 w-4 text-primary" strokeWidth={1.8} />{t('item_details')}</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="name">{t('name')} <span className="text-negative">*</span></Label>
                <Input id="name" value={name} onChange={(e) => setName(e.target.value)} required />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sku">{t('sku')}</Label>
                <Input id="sku" dir="ltr" value={sku || suggestedSku} onChange={(e) => setSku(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="name_en">{t('name_en')}</Label>
                <Input id="name_en" dir="ltr" value={nameEn} onChange={(e) => setNameEn(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="type">{t('type')}</Label>
                <Select id="type" value={type} onChange={(e) => setType(e.target.value)}>
                  <option value="good">{t('good')}</option>
                  <option value="service">{t('service')}</option>
                </Select>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="unit-template">{t('unit_template')}</Label>
                <Select id="unit-template" value={unitTemplateId} onChange={(e) => selectUnitTemplate(e.target.value)}>
                  <option value="">{t('no_unit_template')}</option>
                  {templates.map((template) => <option key={template.id} value={template.id}>{template.name}</option>)}
                </Select>
                <p className="text-xs text-muted">{t('unit_template_hint')}</p>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="unit">{t('unit')}</Label>
                <Input id="unit" value={unit} onChange={(e) => setUnit(e.target.value)} readOnly={Boolean(unitTemplateId)} />
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="barcode">{t('barcode')}</Label>
                <div className="flex gap-2">
                  <Input id="barcode" dir="ltr" className="num" value={barcode} onChange={(e) => setBarcode(e.target.value)} />
                  <Button type="button" variant="outline" size="icon" aria-label={t('generate_barcode')} onClick={() => setBarcode('2' + String(Date.now()).slice(-12))}>
                    <RefreshCw className="h-4 w-4" strokeWidth={1.7} />
                  </Button>
                </div>
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="category">{t('category')}</Label>
                <Input id="category" value={category} onChange={(e) => setCategory(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="brand">{t('brand')}</Label>
                <Input id="brand" value={brand} onChange={(e) => setBrand(e.target.value)} />
              </div>
              {suppliers.length > 0 && (
                <div className="space-y-1.5 sm:col-span-2">
                  <Label htmlFor="supplier">{t('supplier')}</Label>
                  <Select id="supplier" value={supplierId} onChange={(e) => setSupplierId(e.target.value)}>
                    <option value="">{t('no_supplier')}</option>
                    {suppliers.map((s) => (<option key={s.id} value={s.id}>{s.name}</option>))}
                  </Select>
                </div>
              )}
              <div className="space-y-2 sm:col-span-2">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <Label htmlFor="product-images">{t('product_media')}</Label>
                  <span className="text-xs text-muted">{t('selected_media_count', { count: productImages.length, max: MAX_PRODUCT_IMAGES })}</span>
                </div>
                <Input id="product-images" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={saving || productImages.length === MAX_PRODUCT_IMAGES} onChange={selectProductImages} aria-describedby="product-images-hint" />
                <p id="product-images-hint" className="text-xs leading-relaxed text-muted">{t('product_media_hint')}</p>
                {productImages.length > 0 && (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                    {productImages.map((image, index) => (
                      <div key={image.previewUrl} className="overflow-hidden rounded border border-border bg-surface">
                        <div className="aspect-square bg-muted/30">
                          <img src={image.previewUrl} alt={t('image_preview', { number: index + 1 })} className="h-full w-full object-cover" />
                        </div>
                        <div className="flex items-center gap-1 p-2">
                          <span className="min-w-0 flex-1 truncate text-xs text-text" title={image.file.name}>{image.file.name}</span>
                          <Button type="button" variant="ghost" size="icon" aria-label={`${t('delete')}: ${image.file.name}`} disabled={saving} onClick={() => removeProductImage(image.previewUrl)}>
                            <Trash2 className="h-4 w-4" strokeWidth={1.7} />
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
              <div className="space-y-1.5 sm:col-span-2">
                <Label htmlFor="description">{t('description')}</Label>
                <textarea id="description" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} className="min-h-16 w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none placeholder:text-muted focus:border-primary" />
              </div>
            </div>
          </CardContent>
        </Card>

        {/* تفاصيل التسعير */}
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Tag className="h-4 w-4 text-primary" strokeWidth={1.8} />{t('pricing_details')}</CardTitle></CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <div className="space-y-1.5">
                <Label htmlFor="purchase_price">{t('purchase_price')}</Label>
                <Input id="purchase_price" inputMode="decimal" className="num text-end" placeholder="0.00" value={purchasePrice} onChange={(e) => setPurchasePrice(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="sale_price">{t('sale_price')}</Label>
                <Input id="sale_price" inputMode="decimal" className="num text-end" placeholder="0.00" value={salePrice} onChange={(e) => setSalePrice(e.target.value)} />
                {(() => {
                  // تلميح وضع الضريبة (من إعدادات النظام): يوضّح دلالة السعر ويعرض المكمّل.
                  const pm = riyalToMinor(salePrice);
                  const rate = Number(taxRate) || 0;
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
                <Label htmlFor="tax_rate">{t('tax_rate')}</Label>
                <Input id="tax_rate" type="number" min={0} max={100} dir="ltr" className="num text-end" value={taxRate} onChange={(e) => setTaxRate(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="min_sale">{t('min_sale_price')}</Label>
                <Input id="min_sale" inputMode="decimal" className="num text-end" placeholder="0.00" value={minSalePrice} onChange={(e) => setMinSalePrice(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="margin">{t('profit_margin')}</Label>
                <Input id="margin" type="number" min={0} dir="ltr" className="num text-end" value={profitMargin} onChange={(e) => setProfitMargin(e.target.value)} />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="disc">{t('discount')}</Label>
                <div className="flex gap-2">
                  <Input id="disc" type="number" min={0} dir="ltr" className="num text-end" value={discount} onChange={(e) => setDiscount(e.target.value)} />
                  <Select className="w-24" value={discountType} onChange={(e) => setDiscountType(e.target.value)}>
                    <option value="percent">%</option>
                    <option value="amount">﷼</option>
                  </Select>
                </div>
              </div>
              {revenueAccounts.length > 0 && (
                <div className="space-y-1.5">
                  <Label htmlFor="sales_acc">{t('sales_account')}</Label>
                  <Select id="sales_acc" value={salesAccountId} onChange={(e) => setSalesAccountId(e.target.value)}>
                    <option value="">{t('default_account')}</option>
                    {revenueAccounts.map((a) => (<option key={a.id} value={a.id}>{a.code} — {a.name}</option>))}
                  </Select>
                </div>
              )}
              {expenseAccounts.length > 0 && (
                <div className="space-y-1.5">
                  <Label htmlFor="cogs_acc">{t('cogs_account')}</Label>
                  <Select id="cogs_acc" value={cogsAccountId} onChange={(e) => setCogsAccountId(e.target.value)}>
                    <option value="">{t('default_account')}</option>
                    {expenseAccounts.map((a) => (<option key={a.id} value={a.id}>{a.code} — {a.name}</option>))}
                  </Select>
                </div>
              )}
            </div>
          </CardContent>
        </Card>

        {/* إدارة المخزون */}
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><Warehouse className="h-4 w-4 text-primary" strokeWidth={1.8} />{t('inventory_mgmt')}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <label className="flex items-center gap-2 text-sm text-text">
              <input type="checkbox" checked={trackInventory} onChange={(e) => setTrackInventory(e.target.checked)} />
              {t('track_inventory')}
            </label>
            {trackInventory && (
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <div className="space-y-1.5">
                  <Label htmlFor="initial_qty">{t('initial_quantity')}</Label>
                  <Input id="initial_qty" type="number" min={0} dir="ltr" className="num text-end" placeholder="0" value={initialQty} onChange={(e) => setInitialQty(e.target.value)} />
                  <p className="text-[11px] text-muted">{t('initial_quantity_hint')}</p>
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="reorder">{t('reorder_level')}</Label>
                  <Input id="reorder" type="number" min={0} dir="ltr" className="num text-end" placeholder="0" value={reorderLevel} onChange={(e) => setReorderLevel(e.target.value)} />
                </div>
              </div>
            )}
          </CardContent>
        </Card>

        {/* خيارات أكثر */}
        <Card>
          <CardHeader><CardTitle className="flex items-center gap-2"><SlidersHorizontal className="h-4 w-4 text-primary" strokeWidth={1.8} />{t('more_options')}</CardTitle></CardHeader>
          <CardContent className="space-y-3">
            <div className="space-y-1.5">
              <Label htmlFor="tags">{t('tags')}</Label>
              <Input id="tags" placeholder={t('tags_hint')} value={tags} onChange={(e) => setTags(e.target.value)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="notes">{t('internal_notes')}</Label>
              <textarea id="notes" rows={2} value={internalNotes} onChange={(e) => setInternalNotes(e.target.value)} className="w-full resize-y rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus:border-primary" />
            </div>
            <label className="flex items-center gap-2 text-sm text-text">
              <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
              {t('active')}
            </label>
          </CardContent>
        </Card>
      </div>

      {error && <p className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}
    </div>
  );
}
