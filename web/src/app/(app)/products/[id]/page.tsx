'use client';

import { ChangeEvent, useCallback, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight, ImagePlus, Plus, Trash2 } from 'lucide-react';
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

type Product = {
  id: string;
  sku: string | null;
  barcode: string | null;
  name: string;
  name_en: string | null;
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

type Barcode = { id: string; code: string; unit_name: string | null; label: string | null };
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
  const [label, setLabel] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [savingBarcode, setSavingBarcode] = useState(false);
  const [uploading, setUploading] = useState(false);

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
      setProduct(productResult.data);
      setUnitName(productResult.data.unit);
      setBarcodes(barcodeResult.data);
      setActivities(activityResult.data);
      const hydrated = await Promise.all(mediaResult.data.map(async (item) => ({
        ...item,
        previewUrl: await fetchImageUrl(item.download_url),
      })));
      setMedia(hydrated);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('load_profile_failed'));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => () => media.forEach((item) => {
    if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
  }), [media]);

  async function addBarcode() {
    if (!code.trim()) return;
    setSavingBarcode(true);
    setError(null);
    try {
      const result = await api<{ data: Barcode }>(`/products/${id}/barcodes`, {
        method: 'POST', body: { code: code.trim(), unit_name: unitName, label: label.trim() || null },
      });
      setBarcodes((rows) => [result.data, ...rows]);
      setCode('');
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

  async function uploadMedia(e: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(e.target.files ?? []);
    e.target.value = '';
    if (files.length === 0) return;
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
      <div className="flex flex-wrap items-center gap-3">
        <Link href="/products"><Button variant="ghost" size="icon" aria-label={t('back')}><ArrowRight className="h-4 w-4" /></Button></Link>
        <div className="min-w-0">
          <h1 className="truncate text-xl font-semibold text-text">{product.name}</h1>
          <p className="num text-sm text-muted">{product.sku ?? '—'}</p>
        </div>
        <div className="ms-auto"><Badge tone={product.is_active ? 'positive' : 'muted'}>{product.is_active ? t('active') : t('inactive')}</Badge></div>
      </div>

      {error && <p role="alert" className="rounded bg-negative/10 px-3 py-2 text-sm text-negative">{error}</p>}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader><CardTitle>{t('profile_details')}</CardTitle></CardHeader>
          <CardContent className="grid grid-cols-2 gap-4 text-sm">
            <div><p className="text-muted">{t('type')}</p><p>{t(product.type === 'service' ? 'service' : 'good')}</p></div>
            <div><p className="text-muted">{t('unit')}</p><p>{product.unit}</p></div>
            <div><p className="text-muted">{t('sale_price')}</p><p className="num">{formatRiyal(product.sale_price)}</p></div>
            <div><p className="text-muted">{t('min_sale_price')}</p><p className="num">{product.min_sale_price ? formatRiyal(product.min_sale_price) : '—'}</p></div>
            <div><p className="text-muted">{t('tax_rate')}</p><p className="num">{product.tax_rate}%</p></div>
            <div><p className="text-muted">{t('stock')}</p><p className="num">{product.track_inventory ? product.quantity_on_hand : '—'}</p></div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>{t('alternate_barcodes')}</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            <p className="text-xs leading-relaxed text-muted">{t('alternate_barcodes_hint')}</p>
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="space-y-1"><Label htmlFor="barcode-code">{t('barcode_code')}</Label><Input id="barcode-code" dir="ltr" value={code} onChange={(e) => setCode(e.target.value)} /></div>
              <div className="space-y-1"><Label htmlFor="barcode-unit">{t('unit')}</Label><Select id="barcode-unit" value={unitName} onChange={(e) => setUnitName(e.target.value)}>{product.units.length ? product.units.map((unit) => <option key={unit.name} value={unit.name}>{unit.name}</option>) : <option value={product.unit}>{product.unit}</option>}</Select></div>
              <div className="space-y-1"><Label htmlFor="barcode-label">{t('barcode_label')}</Label><Input id="barcode-label" value={label} onChange={(e) => setLabel(e.target.value)} /></div>
            </div>
            <Button type="button" disabled={savingBarcode || !code.trim()} onClick={addBarcode}><Plus className="h-4 w-4" />{t('add_barcode')}</Button>
            {barcodes.length === 0 ? <p className="text-sm text-muted">{t('no_alternate_barcodes')}</p> : <ul className="space-y-2">{barcodes.map((barcode) => <li key={barcode.id} className="flex items-center gap-3 rounded border border-border px-3 py-2"><span className="num min-w-0 flex-1 truncate" dir="ltr">{barcode.code}</span><Badge tone="muted">{barcode.unit_name}</Badge><Button variant="ghost" size="icon" aria-label={t('delete')} onClick={() => removeBarcode(barcode.id)}><Trash2 className="h-4 w-4" /></Button></li>)}</ul>}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader><CardTitle>{t('activity')}</CardTitle></CardHeader>
        <CardContent>
          {activities.length === 0 ? <p className="text-sm text-muted">{t('no_activity')}</p> : <ol className="space-y-3 border-s border-border ps-4">{activities.map((activity) => <li key={activity.id} className="relative"><span aria-hidden className="absolute -start-[1.35rem] top-1.5 h-2.5 w-2.5 rounded-full bg-primary" /><p className="font-medium text-text">{activity.action}</p><p className="text-xs text-muted">{t('activity_by', { name: activity.user?.name ?? t('activity_unknown_user') })}{activity.created_at ? ` · ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(activity.created_at))}` : ''}</p></li>)}</ol>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle>{t('product_media')}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-xs leading-relaxed text-muted">{t('product_media_hint')}</p>
          <div className="flex flex-wrap items-center gap-3"><Label htmlFor="product-media" className="sr-only">{t('upload_media')}</Label><Input id="product-media" type="file" accept="image/jpeg,image/png,image/webp" multiple disabled={uploading} onChange={uploadMedia} className="max-w-sm" /><span className="text-xs text-muted">{uploading ? t('loading_profile') : ''}</span></div>
          {media.length === 0 ? <p className="text-sm text-muted">{t('no_media')}</p> : <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">{media.map((item) => <div key={item.id} className="overflow-hidden rounded border border-border"><div className="aspect-square bg-muted/30">{item.previewUrl ? <img src={item.previewUrl} alt={item.original_name} className="h-full w-full object-cover" /> : <div className="flex h-full items-center justify-center text-muted"><ImagePlus className="h-5 w-5" /></div>}</div><div className="flex items-center gap-1 p-2"><span className="min-w-0 flex-1 truncate text-xs" title={item.original_name}>{item.original_name}</span><Button variant="ghost" size="icon" aria-label={`${t('delete')}: ${item.original_name}`} onClick={() => removeMedia(item.id)}><Trash2 className="h-4 w-4" /></Button></div></div>)}</div>}
        </CardContent>
      </Card>
    </div>
  );
}
