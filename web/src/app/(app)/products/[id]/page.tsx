'use client';

import { ChangeEvent, DragEvent, useCallback, useEffect, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight, ImageOff, ImagePlus, Plus, RefreshCw, Trash2, Upload } from 'lucide-react';
import { api, ApiError, fetchImageUrl } from '@/lib/api';
import { formatRiyal } from '@/lib/money';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';

const MAX_PRODUCT_IMAGES = 8;
const MAX_PRODUCT_IMAGE_SIZE = 5 * 1024 * 1024;
const PRODUCT_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];

type Product = {
  id: string;
  sku: string | null;
  barcode: string | null;
  name: string;
  name_en: string | null;
  description: string | null;
  category: string | null;
  brand: string | null;
  type: 'good' | 'service';
  unit: string;
  units: Array<{ name: string; factor: number }>;
  sale_price: string;
  purchase_price: string;
  min_sale_price: string | null;
  tax_rate: number;
  track_inventory: boolean;
  quantity_on_hand: number;
  is_active: boolean;
};

type Barcode = { id: string; code: string; unit_name: string | null; default_quantity: number; label: string | null };
type ProductMedia = { id: string; original_name: string; download_url: string; sort_order: number; previewUrl?: string | null };
type Activity = { id: string; action: string; created_at: string | null; user: { id: string; name: string } | null };

export default function ProductProfilePage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const t = useTranslations('products');
  const { success } = useToast();
  const [product, setProduct] = useState<Product | null>(null);
  const [barcodes, setBarcodes] = useState<Barcode[]>([]);
  const [media, setMedia] = useState<ProductMedia[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [code, setCode] = useState('');
  const [unitName, setUnitName] = useState('');
  const [defaultQuantity, setDefaultQuantity] = useState('1');
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingBarcode, setSavingBarcode] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [dragActive, setDragActive] = useState(false);
  const [selectedMediaId, setSelectedMediaId] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const mediaObjectUrls = useRef<string[]>([]);

  const revokeMediaObjectUrls = useCallback(() => {
    mediaObjectUrls.current.forEach((url) => URL.revokeObjectURL(url));
    mediaObjectUrls.current = [];
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [productResult, barcodeResult, mediaResult, activityResult] = await Promise.all([
        api<{ data: Product }>(`/products/${id}`),
        api<{ data: Barcode[] }>(`/products/${id}/barcodes`),
        api<{ data: ProductMedia[] }>(`/products/${id}/media`),
        api<{ data: Activity[] }>(`/products/${id}/activity`),
      ]);
      const hydrated = await Promise.all(mediaResult.data.map(async (item) => ({
        ...item,
        previewUrl: await fetchImageUrl(item.download_url),
      })));
      revokeMediaObjectUrls();
      mediaObjectUrls.current = hydrated.flatMap((item) => item.previewUrl ? [item.previewUrl] : []);
      setProduct(productResult.data);
      setUnitName(productResult.data.unit);
      setBarcodes(barcodeResult.data);
      setActivities(activityResult.data);
      setMedia(hydrated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('load_profile_failed'));
    } finally {
      setLoading(false);
    }
  }, [id, revokeMediaObjectUrls, t]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => revokeMediaObjectUrls(), [revokeMediaObjectUrls]);
  useEffect(() => {
    setSelectedMediaId((current) => media.some((item) => item.id === current) ? current : (media[0]?.id ?? null));
  }, [media]);

  const barcodeQuantityValid = /^\d+$/.test(defaultQuantity) && Number(defaultQuantity) >= 1 && Number(defaultQuantity) <= 1000000;
  const selectedMedia = media.find((item) => item.id === selectedMediaId) ?? media[0] ?? null;
  const selectedMediaIndex = selectedMedia ? media.findIndex((item) => item.id === selectedMedia.id) + 1 : 0;

  async function addBarcode() {
    if (!code.trim() || !barcodeQuantityValid) return;
    setSavingBarcode(true);
    setError(null);
    try {
      const result = await api<{ data: Barcode }>(`/products/${id}/barcodes`, {
        method: 'POST', body: { code: code.trim(), unit_name: unitName, default_quantity: Number(defaultQuantity), label: label.trim() || null },
      });
      setBarcodes((rows) => [result.data, ...rows]);
      setCode('');
      setDefaultQuantity('1');
      setLabel('');
      success(t('barcode_added'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('load_profile_failed'));
    } finally {
      setSavingBarcode(false);
    }
  }

  async function removeBarcode(barcodeId: string) {
    setError(null);
    try {
      await api(`/products/${id}/barcodes/${barcodeId}`, { method: 'DELETE' });
      setBarcodes((rows) => rows.filter((row) => row.id !== barcodeId));
      success(t('barcode_deleted'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('load_profile_failed'));
    }
  }

  async function uploadMediaFiles(files: File[]) {
    if (files.length === 0) return;
    if (media.length + files.length > MAX_PRODUCT_IMAGES) {
      setError(t('media_limit_reached'));
      return;
    }
    if (files.some((file) => !PRODUCT_IMAGE_TYPES.includes(file.type) || file.size > MAX_PRODUCT_IMAGE_SIZE)) {
      setError(t('media_invalid_file'));
      return;
    }

    setUploading(true);
    setError(null);
    try {
      const body = new FormData();
      files.forEach((file) => body.append('media[]', file));
      await api(`/products/${id}/media`, { method: 'POST', body });
      await load();
      success(t('media_uploaded'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('load_profile_failed'));
    } finally {
      setUploading(false);
    }
  }

  function uploadMedia(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    void uploadMediaFiles(files);
  }

  function handleDrop(event: DragEvent<HTMLDivElement>) {
    event.preventDefault();
    setDragActive(false);
    if (!uploading && media.length < MAX_PRODUCT_IMAGES) {
      void uploadMediaFiles(Array.from(event.dataTransfer.files));
    }
  }

  async function removeMedia(mediaId: string) {
    setError(null);
    try {
      await api(`/products/${id}/media/${mediaId}`, { method: 'DELETE' });
      await load();
      success(t('media_deleted'));
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('load_profile_failed'));
    }
  }

  if (loading) return <Skeleton className="h-80 w-full" />;
  if (!product) return <p className="rounded bg-negative/10 px-3 py-2 text-sm text-negative">{error ?? t('load_profile_failed')}</p>;

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center gap-3">
        <Link href="/products"><Button variant="ghost" size="icon" aria-label={t('back')}><ArrowRight className="h-4 w-4" /></Button></Link>
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted">{t('profile_title')}</p>
          <h1 className="truncate text-xl font-semibold text-text">{product.name}</h1>
          <p className="num text-sm text-muted">{product.sku ?? '—'}</p>
        </div>
        <div className="ms-auto flex items-center gap-2">
          <Badge tone={product.is_active ? 'positive' : 'muted'}>{product.is_active ? t('active') : t('inactive')}</Badge>
          <Badge tone="muted">{t(product.type === 'service' ? 'service' : 'good')}</Badge>
        </div>
      </header>

      {error && <p role="alert" className="rounded bg-negative/10 px-3 py-2 text-sm text-negative">{error}</p>}

      <section className="grid gap-5 xl:grid-cols-[minmax(0,1.18fr)_minmax(20rem,0.82fr)]" aria-label={t('profile_details')}>
        <Card className="overflow-hidden">
          <CardContent className="p-0">
            <div className="grid min-h-80 md:grid-cols-[minmax(13rem,0.78fr)_minmax(0,1.22fr)]">
              <div className="relative flex min-h-64 items-center justify-center overflow-hidden bg-muted/25">
                {selectedMedia?.previewUrl ? (
                  <Image
                    src={selectedMedia.previewUrl}
                    alt={selectedMedia.original_name}
                    fill
                    priority
                    sizes="(max-width: 767px) 100vw, (max-width: 1280px) 45vw, 34vw"
                    unoptimized
                    className="object-cover"
                  />
                ) : selectedMedia ? (
                  <div className="flex max-w-xs flex-col items-center gap-3 px-6 text-center text-muted" role="status">
                    <ImageOff className="h-8 w-8" strokeWidth={1.5} aria-hidden />
                    <p className="text-sm">{t('image_preview', { number: selectedMediaIndex })}</p>
                    <Button type="button" variant="outline" size="sm" onClick={() => void load()} disabled={loading}>
                      <RefreshCw className="h-4 w-4" />{t('retry')}
                    </Button>
                  </div>
                ) : (
                  <div className="flex max-w-xs flex-col items-center gap-3 px-6 text-center text-muted">
                    <ImagePlus className="h-9 w-9" strokeWidth={1.35} aria-hidden />
                    <p className="text-sm">{t('no_media')}</p>
                    <Button type="button" variant="outline" size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploading}>
                      <Upload className="h-4 w-4" />{t('upload_media')}
                    </Button>
                  </div>
                )}
              </div>

              <div className="flex min-w-0 flex-col p-5 sm:p-6">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <h2 className="text-base font-semibold text-text">{t('profile_details')}</h2>
                    <p className="mt-1 text-sm leading-relaxed text-muted">{product.description || '—'}</p>
                  </div>
                  <span className="num rounded-full bg-muted/50 px-2.5 py-1 text-xs text-muted">{t('selected_media_count', { count: media.length, max: MAX_PRODUCT_IMAGES })}</span>
                </div>

                <dl className="mt-5 grid grid-cols-2 gap-x-5 gap-y-4 text-sm">
                  <div><dt className="text-muted">{t('category')}</dt><dd className="mt-1 font-medium text-text">{product.category || t('unclassified')}</dd></div>
                  <div><dt className="text-muted">{t('brand')}</dt><dd className="mt-1 font-medium text-text">{product.brand || '—'}</dd></div>
                  <div><dt className="text-muted">{t('unit')}</dt><dd className="mt-1 font-medium text-text">{product.unit}</dd></div>
                  <div><dt className="text-muted">{t('tax_rate')}</dt><dd className="mt-1 font-medium num text-text">{product.tax_rate}%</dd></div>
                  <div><dt className="text-muted">{t('sale_price')}</dt><dd className="mt-1 font-semibold num text-text">{formatRiyal(product.sale_price)}</dd></div>
                  <div><dt className="text-muted">{t('min_sale_price')}</dt><dd className="mt-1 font-semibold num text-text">{product.min_sale_price ? formatRiyal(product.min_sale_price) : '—'}</dd></div>
                  <div><dt className="text-muted">{t('stock')}</dt><dd className="mt-1 font-semibold num text-text">{product.track_inventory ? product.quantity_on_hand : '—'}</dd></div>
                  <div><dt className="text-muted">{t('purchase_price')}</dt><dd className="mt-1 font-medium num text-text">{formatRiyal(product.purchase_price)}</dd></div>
                </dl>
              </div>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
            <div>
              <CardTitle>{t('product_media')}</CardTitle>
              <p className="mt-1 text-xs leading-relaxed text-muted">{t('product_media_hint')}</p>
            </div>
            <Button type="button" size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploading || media.length >= MAX_PRODUCT_IMAGES}>
              <Upload className="h-4 w-4" />{t('upload_media')}
            </Button>
          </CardHeader>
          <CardContent className="space-y-3">
            <Input ref={fileInputRef} id="product-media" type="file" accept={PRODUCT_IMAGE_TYPES.join(',')} multiple disabled={uploading || media.length >= MAX_PRODUCT_IMAGES} onChange={uploadMedia} className="sr-only" />
            <div
              className={`rounded-lg border border-dashed p-3 transition-colors ${dragActive ? 'border-primary bg-primary/5' : 'border-border bg-muted/15'}`}
              onDragEnter={(event) => { event.preventDefault(); setDragActive(true); }}
              onDragOver={(event) => event.preventDefault()}
              onDragLeave={() => setDragActive(false)}
              onDrop={handleDrop}
            >
              {uploading ? (
                <div className="flex min-h-20 items-center justify-center text-sm text-muted">{t('loading_profile')}</div>
              ) : media.length === 0 ? (
                <button type="button" className="flex min-h-20 w-full flex-col items-center justify-center gap-1.5 text-center text-sm text-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" onClick={() => fileInputRef.current?.click()}>
                  <ImagePlus className="h-5 w-5" strokeWidth={1.5} aria-hidden />
                  <span>{t('upload_media')}</span>
                </button>
              ) : (
                <div className="grid grid-cols-4 gap-2">
                  {media.map((item, index) => (
                    <button
                      key={item.id}
                      type="button"
                      className={`relative aspect-square overflow-hidden rounded border bg-surface text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${selectedMedia?.id === item.id ? 'border-primary ring-2 ring-primary/25' : 'border-border'}`}
                      aria-label={t('image_preview', { number: index + 1 })}
                      aria-pressed={selectedMedia?.id === item.id}
                      onClick={() => setSelectedMediaId(item.id)}
                    >
                      {item.previewUrl ? <Image src={item.previewUrl} alt={item.original_name} fill sizes="(max-width: 640px) 25vw, 115px" unoptimized className="object-cover" /> : <span className="grid h-full place-items-center text-muted" aria-hidden><ImageOff className="h-4 w-4" /></span>}
                      <span className="sr-only">{item.original_name}</span>
                    </button>
                  ))}
                  {media.length < MAX_PRODUCT_IMAGES && (
                    <button type="button" className="grid aspect-square place-items-center rounded border border-dashed border-border bg-surface text-muted transition-colors hover:border-primary hover:text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" onClick={() => fileInputRef.current?.click()} aria-label={t('upload_media')}>
                      <Plus className="h-5 w-5" />
                    </button>
                  )}
                </div>
              )}
            </div>
            {selectedMedia && (
              <div className="flex min-w-0 items-center gap-2 rounded-md bg-muted/30 px-2.5 py-2">
                <span className="min-w-0 flex-1 truncate text-xs text-muted" title={selectedMedia.original_name}>{selectedMedia.original_name}</span>
                <Button type="button" variant="ghost" size="icon" aria-label={`${t('delete')}: ${selectedMedia.original_name}`} onClick={() => void removeMedia(selectedMedia.id)} disabled={uploading}>
                  <Trash2 className="h-4 w-4" />
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{t('alternate_barcodes')}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs leading-relaxed text-muted">{t('alternate_barcodes_hint')}</p>
            <div className="grid gap-2 sm:grid-cols-4">
              <div className="space-y-1"><Label htmlFor="barcode-code">{t('barcode_code')}</Label><Input id="barcode-code" dir="ltr" value={code} onChange={(e) => setCode(e.target.value)} /></div>
              <div className="space-y-1"><Label htmlFor="barcode-unit">{t('unit')}</Label><Select id="barcode-unit" value={unitName} onChange={(e) => setUnitName(e.target.value)}>{product.units.length ? product.units.map((unit) => <option key={unit.name} value={unit.name}>{unit.name}</option>) : <option value={product.unit}>{product.unit}</option>}</Select></div>
              <div className="space-y-1"><Label htmlFor="barcode-default-quantity">{t('barcode_default_quantity')}</Label><Input id="barcode-default-quantity" type="number" min="1" max="1000000" inputMode="numeric" value={defaultQuantity} onChange={(e) => setDefaultQuantity(e.target.value)} aria-invalid={defaultQuantity !== '' && !barcodeQuantityValid} aria-describedby={defaultQuantity !== '' && !barcodeQuantityValid ? 'barcode-default-quantity-error' : undefined} />{defaultQuantity !== '' && !barcodeQuantityValid && <p id="barcode-default-quantity-error" role="alert" className="text-xs text-negative">{t('barcode_quantity_invalid')}</p>}</div>
              <div className="space-y-1"><Label htmlFor="barcode-label">{t('barcode_label')}</Label><Input id="barcode-label" value={label} onChange={(e) => setLabel(e.target.value)} /></div>
            </div>
            <Button type="button" disabled={savingBarcode || !code.trim() || !barcodeQuantityValid} onClick={() => void addBarcode()}><Plus className="h-4 w-4" />{t('add_barcode')}</Button>
            {barcodes.length === 0 ? <p className="text-sm text-muted">{t('no_alternate_barcodes')}</p> : <ul className="space-y-2">{barcodes.map((barcode) => <li key={barcode.id} className="flex items-center gap-3 rounded border border-border px-3 py-2"><span className="num min-w-0 flex-1 truncate" dir="ltr">{barcode.code}</span><Badge tone="muted">{barcode.unit_name}</Badge><span className="num text-xs text-muted">{t('barcode_quantity', { quantity: barcode.default_quantity })}</span><Button type="button" variant="ghost" size="icon" aria-label={`${t('delete')}: ${barcode.code}`} onClick={() => void removeBarcode(barcode.id)}><Trash2 className="h-4 w-4" /></Button></li>)}</ul>}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{t('activity')}</CardTitle></CardHeader>
          <CardContent>
            {activities.length === 0 ? <p className="text-sm text-muted">{t('no_activity')}</p> : <ol className="space-y-3 border-s border-border ps-4">{activities.map((activity) => <li key={activity.id} className="relative"><span aria-hidden className="absolute -start-[1.35rem] top-1.5 h-2.5 w-2.5 rounded-full bg-primary" /><p className="font-medium text-text">{activity.action}</p><p className="text-xs text-muted">{t('activity_by', { name: activity.user?.name ?? t('activity_unknown_user') })}{activity.created_at ? ` · ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(activity.created_at))}` : ''}</p></li>)}</ol>}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
