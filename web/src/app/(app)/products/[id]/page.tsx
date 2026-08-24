'use client';
import { DISPLAY_LOCALE } from '@/lib/formatting';

import { ChangeEvent, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight, ArrowLeftRight, Copy, ImageOff, ImagePlus, MoreVertical, Pencil, Plus, ReceiptText, RefreshCw, Trash2, Upload } from 'lucide-react';
import { api, ApiError, fetchImageUrl } from '@/lib/api';
import { formatRiyal } from '@/lib/money';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dropdown, DropdownItem } from '@/components/ui/dropdown';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Tabs, TabPanel, type TabDef } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { ProductDialog, type Product as ProductFormProduct } from '@/components/products/product-dialog';

type Product = ProductFormProduct & {
  units: Array<{ name: string; factor: number }>;
};

type ProductMedia = { id: string; original_name: string; download_url: string; sort_order: number; previewUrl?: string | null };
type Activity = { id: string; action: string; created_at: string | null; user: { id: string; name: string } | null };
type Movement = { id: string; type: string; quantity: number; unit_cost: string; total_cost: string; balance_quantity: number; movement_date: string | null; notes: string | null };

const MAX_PRODUCT_IMAGES = 8;
const MAX_PRODUCT_IMAGE_SIZE = 5 * 1024 * 1024;
const PRODUCT_IMAGE_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const movementTone: Record<string, 'positive' | 'warning' | 'muted'> = { in: 'positive', out: 'warning', adjustment: 'muted' };

export default function ProductProfilePage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const t = useTranslations('products');
  const ti = useTranslations('inventory');
  const { success, error: showError } = useToast();
  const [product, setProduct] = useState<Product | null>(null);
  const [media, setMedia] = useState<ProductMedia[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [movements, setMovements] = useState<Movement[] | null>(null);
  const [selectedMediaId, setSelectedMediaId] = useState<string | null>(null);
  const [activeTab, setActiveTab] = useState('info');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [uploading, setUploading] = useState(false);
  const [editing, setEditing] = useState(false);
  const [deleting, setDeleting] = useState(false);
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
      const [productResult, mediaResult, activityResult] = await Promise.all([
        api<{ data: Product }>(`/products/${id}`),
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
      setMedia(hydrated);
      setActivities(activityResult.data);
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
  useEffect(() => {
    if (activeTab !== 'movements' || movements !== null) return;
    api<{ data: Movement[] }>(`/inventory/${id}/movements`)
      .then((result) => setMovements(result.data))
      .catch(() => setMovements([]));
  }, [activeTab, id, movements]);

  const selectedMedia = media.find((item) => item.id === selectedMediaId) ?? media[0] ?? null;
  const selectedMediaIndex = selectedMedia ? media.findIndex((item) => item.id === selectedMedia.id) + 1 : 0;
  const tabs = useMemo<TabDef[]>(() => [
    { id: 'info', label: t('product_info') },
    { id: 'movements', label: t('inventory_movements') },
    { id: 'timeline', label: t('timeline') },
    { id: 'activity', label: t('activity'), count: activities.length },
  ], [activities.length, t]);

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
      const message = err instanceof ApiError ? err.message : t('load_profile_failed');
      setError(message);
      showError(message);
    } finally {
      setUploading(false);
    }
  }

  function uploadMedia(event: ChangeEvent<HTMLInputElement>) {
    const files = Array.from(event.target.files ?? []);
    event.target.value = '';
    void uploadMediaFiles(files);
  }

  async function removeMedia(mediaId: string) {
    setError(null);
    try {
      await api(`/products/${id}/media/${mediaId}`, { method: 'DELETE' });
      await load();
      success(t('media_deleted'));
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('load_profile_failed');
      setError(message);
      showError(message);
    }
  }

  async function copyProduct() {
    if (!product) return;
    try {
      await api('/products', {
        method: 'POST',
        body: {
          name: `${product.name} — ${t('copy')}`,
          name_en: product.name_en,
          sku: null,
          barcode: null,
          type: product.type,
          unit: product.unit,
          description: product.description,
          category_id: product.category_id,
          brand_id: product.brand_id,
          unit_template_id: product.unit_template_id,
          reorder_level: product.reorder_level,
          min_sale_price: product.min_sale_price ? Math.round(Number(product.min_sale_price) * 100) : null,
          discount: product.discount,
          discount_type: product.discount_type,
          profit_margin: product.profit_margin,
          tags: product.tags,
          internal_notes: product.internal_notes,
          sales_account_id: product.sales_account_id,
          cogs_account_id: product.cogs_account_id,
          sale_price: Math.round(Number(product.sale_price) * 100),
          purchase_price: Math.round(Number(product.purchase_price) * 100),
          tax_rate: product.tax_rate,
          track_inventory: product.track_inventory,
          initial_quantity: 0,
          is_active: product.is_active,
        },
      });
      success(t('copy_success'));
    } catch (err) {
      showError(err instanceof ApiError ? err.message : t('action_failed'));
    }
  }

  async function deleteProduct() {
    if (!product || !window.confirm(t('delete_confirm', { name: product.name }))) return;
    setDeleting(true);
    try {
      await api(`/products/${id}`, { method: 'DELETE' });
      window.location.assign('/products');
    } catch (err) {
      showError(err instanceof ApiError ? err.message : t('action_failed'));
      setDeleting(false);
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
          <Button type="button" variant="outline" size="sm" onClick={() => setEditing(true)}><Pencil className="h-4 w-4" />{t('edit')}</Button>
          <Dropdown
            trigger={<MoreVertical className="h-5 w-5" strokeWidth={1.8} />}
            triggerLabel={t('more_actions')}
            menuLabel={t('more_actions')}
            triggerClassName="h-9 w-9 justify-center border border-border bg-surface text-text hover:bg-primary-soft"
            mobilePopover
          >
            <DropdownItem href={`/stock-permits/new?type=transfer&product=${id}`} icon={ArrowLeftRight}>{t('transfer_stock')}</DropdownItem>
            <DropdownItem href={`/stock-permits/new?type=receipt&product=${id}`} icon={Plus}>{t('add_inventory_operation')}</DropdownItem>
            <DropdownItem href={`/stock-permits/new?type=issue&product=${id}`} icon={ReceiptText}>{t('issue_stock')}</DropdownItem>
            <DropdownItem icon={Copy} onClick={() => void copyProduct()}>{t('copy')}</DropdownItem>
            <DropdownItem icon={Trash2} tone="danger" disabled={deleting} onClick={() => void deleteProduct()}>{t('delete')}</DropdownItem>
          </Dropdown>
        </div>
      </header>

      {error && <p role="alert" className="rounded bg-negative/10 px-3 py-2 text-sm text-negative">{error}</p>}

      <section className="grid gap-3 sm:grid-cols-3" aria-label={t('product_info')}>
        <Card><CardContent className="p-4"><p className="text-xs text-muted">{t('stock')}</p><p className="mt-1 text-lg font-semibold num text-text">{product.track_inventory ? product.quantity_on_hand : '—'}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted">{t('avg_cost')}</p><p className="mt-1 text-lg font-semibold num text-text">{formatRiyal(product.avg_cost)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted">{t('sale_price')}</p><p className="mt-1 text-lg font-semibold num text-text">{formatRiyal(product.sale_price)}</p></CardContent></Card>
      </section>

      <Tabs tabs={tabs} value={activeTab} onChange={setActiveTab} />

      {activeTab === 'info' && (
        <TabPanel id="info">
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
              <div>
                <CardTitle>{t('item_details')}</CardTitle>
                <p className="mt-1 text-xs text-muted">{t('product_media_hint')}</p>
              </div>
              <Button type="button" size="sm" onClick={() => fileInputRef.current?.click()} disabled={uploading || media.length >= MAX_PRODUCT_IMAGES}>
                <Upload className="h-4 w-4" />{t('upload_media')}
              </Button>
            </CardHeader>
            <CardContent className="grid gap-6 lg:grid-cols-[minmax(15rem,0.72fr)_minmax(0,1.28fr)]">
              <div className="space-y-3">
                <Input ref={fileInputRef} id="product-media" type="file" accept={PRODUCT_IMAGE_TYPES.join(',')} multiple disabled={uploading || media.length >= MAX_PRODUCT_IMAGES} onChange={uploadMedia} className="sr-only" />
                <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded border border-border bg-muted/20">
                  {selectedMedia?.previewUrl ? (
                    <Image src={selectedMedia.previewUrl} alt={selectedMedia.original_name} fill priority unoptimized sizes="(max-width: 1024px) 100vw, 34vw" className="object-cover" />
                  ) : selectedMedia ? (
                    <div className="flex flex-col items-center gap-2 px-5 text-center text-muted" role="status"><ImageOff className="h-8 w-8" strokeWidth={1.5} aria-hidden /><span className="text-sm">{t('image_preview', { number: selectedMediaIndex })}</span><Button type="button" variant="outline" size="sm" onClick={() => void load()}><RefreshCw className="h-4 w-4" />{t('retry')}</Button></div>
                  ) : (
                    <button type="button" className="flex h-full w-full flex-col items-center justify-center gap-3 text-muted hover:bg-primary/5 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" onClick={() => fileInputRef.current?.click()}><ImagePlus className="h-10 w-10" strokeWidth={1.35} aria-hidden /><span className="text-sm">{t('upload_media')}</span></button>
                  )}
                </div>
                {media.length > 0 && (
                  <div className="grid grid-cols-5 gap-2">
                    {media.map((item, index) => (
                      <button key={item.id} type="button" className={`relative aspect-square overflow-hidden rounded border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${selectedMedia?.id === item.id ? 'border-primary ring-2 ring-primary/25' : 'border-border'}`} aria-label={t('image_preview', { number: index + 1 })} aria-pressed={selectedMedia?.id === item.id} onClick={() => setSelectedMediaId(item.id)}>
                        {item.previewUrl ? <Image src={item.previewUrl} alt={item.original_name} fill unoptimized sizes="100px" className="object-cover" /> : <span className="grid h-full place-items-center text-muted" aria-hidden><ImageOff className="h-4 w-4" /></span>}
                      </button>
                    ))}
                  </div>
                )}
                {selectedMedia && <div className="flex items-center gap-2 rounded bg-muted/30 px-2.5 py-2"><span className="min-w-0 flex-1 truncate text-xs text-muted" title={selectedMedia.original_name}>{selectedMedia.original_name}</span><Button type="button" variant="ghost" size="icon" aria-label={`${t('delete')}: ${selectedMedia.original_name}`} onClick={() => void removeMedia(selectedMedia.id)} disabled={uploading}><Trash2 className="h-4 w-4" /></Button></div>}
              </div>

              <dl className="grid content-start gap-4 text-sm sm:grid-cols-2">
                <div><dt className="text-muted">{t('sku')}</dt><dd className="mt-1 font-medium num text-text">{product.sku ?? '—'}</dd></div>
                <div><dt className="text-muted">{t('barcode')}</dt><dd className="mt-1 font-medium num text-text" dir="ltr">{product.barcode ?? '—'}</dd></div>
                <div><dt className="text-muted">{t('sale_price')}</dt><dd className="mt-1 font-semibold num text-text">{formatRiyal(product.sale_price)} <span className="font-normal text-muted">/ {product.unit}</span></dd></div>
                <div><dt className="text-muted">{t('purchase_price')}</dt><dd className="mt-1 font-semibold num text-text">{formatRiyal(product.purchase_price)} <span className="font-normal text-muted">/ {product.unit}</span></dd></div>
                <div><dt className="text-muted">{t('category')}</dt><dd className="mt-1 font-medium text-text">{product.category || t('unclassified')}</dd></div>
                <div><dt className="text-muted">{t('brand')}</dt><dd className="mt-1 font-medium text-text">{product.brand || '—'}</dd></div>
              </dl>
            </CardContent>
          </Card>
        </TabPanel>
      )}

      {activeTab === 'movements' && (
        <TabPanel id="movements">
          <Card>
            <CardHeader><CardTitle>{t('inventory_movements')}</CardTitle></CardHeader>
            <CardContent>
              {movements === null ? <Skeleton className="h-40 w-full" /> : movements.length === 0 ? <p className="py-8 text-center text-sm text-muted">{ti('empty')}</p> : <div className="overflow-x-auto rounded border border-border"><Table><THead><TR><TH>{ti('date')}</TH><TH>{ti('type')}</TH><TH className="text-end">{ti('qty')}</TH><TH className="text-end">{ti('avg_cost')}</TH><TH className="text-end">{ti('balance')}</TH></TR></THead><TBody>{movements.map((movement) => <TR key={movement.id}><TD className="num text-muted">{movement.movement_date ?? '—'}</TD><TD><Badge tone={movementTone[movement.type] ?? 'muted'}>{ti(movement.type)}</Badge></TD><TD className="num text-end">{movement.quantity}</TD><TD className="num text-end">{formatRiyal(movement.unit_cost)}</TD><TD className="num text-end font-medium">{movement.balance_quantity}</TD></TR>)}</TBody></Table></div>}
            </CardContent>
          </Card>
        </TabPanel>
      )}

      {activeTab === 'timeline' && (
        <TabPanel id="timeline">
          <Card><CardHeader><CardTitle>{t('timeline')}</CardTitle></CardHeader><CardContent><p className="text-sm text-muted">{t('timeline_next_stage')}</p></CardContent></Card>
        </TabPanel>
      )}

      {activeTab === 'activity' && (
        <TabPanel id="activity">
          <Card>
            <CardHeader><CardTitle>{t('activity')}</CardTitle></CardHeader>
            <CardContent>
              {activities.length === 0 ? <p className="text-sm text-muted">{t('no_activity')}</p> : <ol className="space-y-3 border-s border-border ps-4">{activities.map((activity) => <li key={activity.id} className="relative"><span aria-hidden className="absolute -start-[1.35rem] top-1.5 h-2.5 w-2.5 rounded-full bg-primary" /><p className="font-medium text-text">{activity.action}</p><p className="text-xs text-muted">{t('activity_by', { name: activity.user?.name ?? t('activity_unknown_user') })}{activity.created_at ? ` · ${new Intl.DateTimeFormat(DISPLAY_LOCALE, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(activity.created_at))}` : ''}</p></li>)}</ol>}
            </CardContent>
          </Card>
        </TabPanel>
      )}

      <ProductDialog key={product.id} open={editing} onClose={() => setEditing(false)} onSaved={() => { setEditing(false); void load(); }} product={product} />
    </div>
  );
}
