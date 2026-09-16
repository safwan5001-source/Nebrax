'use client';

import Link from 'next/link';
import { ChangeEvent, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight, Trash2, Plus } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { ApiError, api } from '@/lib/api';
import { riyalToMinor, formatRiyal } from '@/lib/money';
import { ProductPublicationFields } from '@/components/products/product-publication-fields';
import { ProductWorkspace } from '@/components/products/product-workspace';
import { replaceProductPublication } from '@/modules/products/publication';
import { useProductPublication } from '@/modules/products/use-product-publication';

interface SelectedProductImage { file: File; previewUrl: string }
interface PendingBarcode { code: string; unit_name: string; default_quantity: string; label: string; price: string }

const MAX_PRODUCT_IMAGES = 8;
const MAX_PRODUCT_IMAGE_SIZE = 5 * 1024 * 1024;
const PRODUCT_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * غلافٌ رقيقٌ حول `ProductWorkspace` (PR-PROD-UX-1). الباركود المتعدّد وقت
 * الإنشاء، الوسائط، والنشر التجاري تبقى مملوكةً لهذه الصفحة تماماً كما كانت —
 * `ProductWorkspace` لا يعرف عنها شيئاً؛ حقول الباركود/الأسعار المُعلَّقة تُدمَج
 * في نفس طلب `POST /products` الأول عبر `extraCreatePayload` فقط، فيبقى العقد
 * «طلبٌ واحدٌ بالضبط» قائماً حرفياً كما كان قبل هذا الإصلاح.
 */
export default function NewProductPage() {
  const t = useTranslations('products');
  const tc = useTranslations('common');
  const router = useRouter();
  const { success, error: toastError } = useToast();

  const [productId, setProductId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [finishing, setFinishing] = useState(false);
  const [productImages, setProductImages] = useState<SelectedProductImage[]>([]);
  const [pendingBarcodes, setPendingBarcodes] = useState<PendingBarcode[]>([]);
  const [newBarcodeCode, setNewBarcodeCode] = useState('');
  const [newBarcodeUnit, setNewBarcodeUnit] = useState('');
  const [newBarcodeQty, setNewBarcodeQty] = useState('1');
  const [newBarcodeLabel, setNewBarcodeLabel] = useState('');
  const [newBarcodePrice, setNewBarcodePrice] = useState('');
  const [alternateUnits, setAlternateUnits] = useState<{ name: string; factor: number }[]>([]);
  const productImageUrls = useRef<string[]>([]);
  const publication = useProductPublication();

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

  function addPendingBarcode() {
    const code = newBarcodeCode.trim();
    if (!code) return;
    const qty = newBarcodeQty.trim() === '' ? 1 : Number(newBarcodeQty);
    if (!Number.isInteger(qty) || qty < 1 || qty > 1000000) {
      setError(t('barcode_quantity_invalid'));
      return;
    }
    const priceInput = newBarcodePrice.trim();
    if (priceInput !== '' && !Number.isFinite(riyalToMinor(priceInput))) {
      setError(t('unit_price_invalid'));
      return;
    }
    setError(null);
    setPendingBarcodes((current) => [
      ...current,
      { code, unit_name: newBarcodeUnit, default_quantity: String(qty), label: newBarcodeLabel.trim(), price: priceInput },
    ]);
    setNewBarcodeCode('');
    setNewBarcodeUnit('');
    setNewBarcodeQty('1');
    setNewBarcodeLabel('');
    setNewBarcodePrice('');
  }

  function removePendingBarcode(code: string) {
    setPendingBarcodes((current) => current.filter((item) => item.code !== code));
  }

  const extraCreatePayload = {
    barcodes: pendingBarcodes.map((item) => ({
      code: item.code,
      unit_name: item.unit_name || null,
      default_quantity: Number(item.default_quantity) || 1,
      label: item.label || null,
    })),
    unit_prices: Array.from(
      new Map(
        pendingBarcodes
          .filter((item) => item.price.trim() !== '')
          .map((item) => [item.unit_name || '', { unit_name: item.unit_name || null, price: riyalToMinor(item.price) }]),
      ).values(),
    ),
  };

  /** يُستدعى مرّةً واحدة فور نجاح `POST /products` — لا يُعاد استدعاؤه لاحقاً. */
  async function afterCreated(id: string) {
    setProductId(id);
    await finishUp(id);
  }

  async function finishUp(id: string) {
    setFinishing(true);
    setError(null);
    try {
      if (publication.status === 'ready') {
        try {
          await replaceProductPublication(id, publication.selectedIds);
        } catch {
          setError(t('publication_failed_after_create'));
          toastError(t('product_created_publication_pending'));
          return;
        }
      }

      if (productImages.length > 0) {
        const mediaBody = new FormData();
        productImages.forEach(({ file }) => mediaBody.append('media[]', file));
        try {
          await api(`/products/${id}/media`, { method: 'POST', body: mediaBody });
        } catch {
          toastError(t('media_upload_failed_after_create'));
          router.push(`/products/${id}`);
          return;
        }
      }

      success(tc('created'));
      router.push('/products');
    } catch (err) {
      setError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setFinishing(false);
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button asChild variant="ghost" size="icon" aria-label={t('back')}><Link href='/products'>
          <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
        </Link></Button>
        <h1 className="text-xl font-semibold text-text">{t('new_title')}</h1>
      </div>

      <ProductWorkspace
        mode="create"
        extraCreatePayload={extraCreatePayload}
        onCreated={afterCreated}
        onUpdated={(id) => void finishUp(id)}
        onAlternateUnitsChange={(units) => setAlternateUnits(units)}
        saveLabel={productId ? t('retry_publication') : undefined}
        cancelHref="/products"
      />

      {/* الباركود المتعدّد وقت الإنشاء — يبقى كما كان تماماً، خارج ProductWorkspace
          (تكامله الكامل ضمن مساحة العمل مؤجَّلٌ لـ PR-PROD-UX-2). */}
      <Card>
        <CardHeader><CardTitle>{t('barcode_code')}</CardTitle></CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Input id="new-barcode-code" dir="ltr" className="num" value={newBarcodeCode} onChange={(e) => setNewBarcodeCode(e.target.value)} disabled={finishing || Boolean(productId)} />
            </div>
            <div className="space-y-1.5">
              <Select id="new-barcode-unit" value={newBarcodeUnit} onChange={(e) => setNewBarcodeUnit(e.target.value)} disabled={finishing || Boolean(productId)}>
                <option value="">{t('default_unit_base_option')}</option>
                {alternateUnits.map((u) => <option key={u.name} value={u.name}>{u.name}</option>)}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-barcode-qty">{t('barcode_default_quantity')}</Label>
              <Input id="new-barcode-qty" type="number" min={1} max={1000000} className="num text-end" value={newBarcodeQty} onChange={(e) => setNewBarcodeQty(e.target.value)} disabled={finishing || Boolean(productId)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-barcode-label">{t('barcode_label')}</Label>
              <Input id="new-barcode-label" value={newBarcodeLabel} onChange={(e) => setNewBarcodeLabel(e.target.value)} disabled={finishing || Boolean(productId)} />
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="new-barcode-price">{t('multi_barcode_col_price')}</Label>
              <Input id="new-barcode-price" type="text" inputMode="decimal" dir="ltr" className="num text-end" placeholder="0.00" value={newBarcodePrice} onChange={(e) => setNewBarcodePrice(e.target.value)} disabled={finishing || Boolean(productId)} />
            </div>
          </div>
          <div className="flex justify-end">
            <Button type="button" variant="outline" size="sm" disabled={!newBarcodeCode.trim() || finishing || Boolean(productId)} onClick={addPendingBarcode}>
              <Plus className="h-4 w-4" strokeWidth={1.7} />{t('add_barcode')}
            </Button>
          </div>
          {pendingBarcodes.length === 0 ? (
            <p className="rounded-md bg-background px-3 py-2 text-sm text-muted">{t('no_alternate_barcodes')}</p>
          ) : (
            <ul className="divide-y divide-border rounded-md border border-border">
              {pendingBarcodes.map((item) => (
                <li key={item.code} className="flex items-center gap-2 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <p className="num text-sm font-medium text-text" dir="ltr">{item.code}</p>
                    <p className="text-xs text-muted">
                      {item.unit_name ?? t('default_unit_base_option')} · {t('barcode_quantity', { quantity: Number(item.default_quantity) || 1 })}
                      {item.label ? ` · ${item.label}` : ''}
                      {item.price ? ` · ${formatRiyal(riyalToMinor(item.price))}` : ''}
                    </p>
                  </div>
                  <Button type="button" variant="ghost" size="icon" aria-label={`${t('delete')}: ${item.code}`} disabled={finishing || Boolean(productId)} onClick={() => removePendingBarcode(item.code)}>
                    <Trash2 className="h-4 w-4" strokeWidth={1.7} />
                  </Button>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t('product_media')}</CardTitle></CardHeader>
        <CardContent className="space-y-2">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <Label htmlFor="product-images">{t('product_media')}</Label>
            <span className="text-xs text-muted">{t('selected_media_count', { count: productImages.length, max: MAX_PRODUCT_IMAGES })}</span>
          </div>
          <Input id="product-images" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={finishing || productImages.length === MAX_PRODUCT_IMAGES} onChange={selectProductImages} aria-describedby="product-images-hint" />
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
                    <Button type="button" variant="ghost" size="icon" aria-label={`${t('delete')}: ${image.file.name}`} disabled={finishing} onClick={() => removeProductImage(image.previewUrl)}>
                      <Trash2 className="h-4 w-4" strokeWidth={1.7} />
                    </Button>
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <ProductPublicationFields
        status={publication.status}
        stores={publication.stores}
        selectedIds={publication.selectedIds}
        disabled={finishing}
        onChange={publication.setSelectedIds}
        onRetry={() => void publication.reload()}
        labels={{
          title: t('online_store'),
          availableOnline: t('available_online'),
          hint: t('publication_hint'),
          loading: t('publication_loading'),
          empty: t('publication_empty'),
          loadFailed: t('publication_load_failed'),
          retry: t('retry'),
        }}
      />

      {error && <p className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}
    </div>
  );
}
