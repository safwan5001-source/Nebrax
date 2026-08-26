'use client';

import { DISPLAY_LOCALE } from '@/lib/formatting';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Image from 'next/image';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowLeftRight, Copy, ImageOff, Pencil, Plus, ReceiptText, Trash2 } from 'lucide-react';
import { api, ApiError, fetchImageUrl } from '@/lib/api';
import { formatRiyal } from '@/lib/money';
import { Badge } from '@/components/ui/badge';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import {
  DetailPage, DetailSummary, EmptyState, ErrorState, FormAlert, LoadingState,
  type DetailSection, type PageAction,
} from '@/components/nebrax';
import type { ProductApi } from '@/components/products/product-form';

type ProductMedia = { id: string; original_name: string; download_url: string; sort_order: number; previewUrl?: string | null };
type Activity = { id: string; action: string; created_at: string | null; user: { id: string; name: string } | null };
type Movement = {
  id: string; type: string; quantity: number; unit_cost: string; total_cost: string;
  balance_quantity: number; movement_date: string | null; notes: string | null;
};

const movementTone: Record<string, 'positive' | 'warning' | 'muted'> = {
  in: 'positive', out: 'warning', adjustment: 'muted',
};

/** سطر «تسمية ← قيمة» داخل قسم التفاصيل. المُعرّفات والمبالغ بخط Mono. */
function Fact({ label, value, mono, dir }: { label: string; value: React.ReactNode; mono?: boolean; dir?: 'ltr' }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={`mt-0.5 break-words text-sm font-medium text-text${mono ? ' num' : ''}`} dir={dir}>{value}</dd>
    </div>
  );
}

/**
 * ملفّ المنتج — **صفحة تفاصيل**، لا نموذج معطّل ولا مساحة عمل مستندية.
 *
 * لا قوالب طباعة مجمّدة ولا ZATCA ولا تصدير رسمي هنا، فلا شيء يبرّر عائلةً
 * ثالثة: النمط المعتمد (`DetailPage`) يعطي الأقسام مطويّةً على الجوال ومبسوطةً
 * على الديسكتوب، والملخّص المالي في عمودٍ لاصق.
 *
 * التحرير انتقل إلى `/products/[id]/edit`: نموذجٌ كامل بشريط إجراءات مثبَّت،
 * بدل حوارٍ بثلاثة أعمدة ثابتة لا تنكسر على شاشة هاتف.
 */
export default function ProductProfilePage() {
  const { id } = useParams<{ id: string }>();
  const router = useRouter();
  const t = useTranslations('products');
  const ti = useTranslations('inventory');
  const { success, error: showError } = useToast();

  const [product, setProduct] = useState<ProductApi | null>(null);
  const [media, setMedia] = useState<ProductMedia[]>([]);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [movements, setMovements] = useState<Movement[] | null>(null);
  const [selectedMediaId, setSelectedMediaId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);
  const mediaObjectUrls = useRef<string[]>([]);

  const revokeMediaObjectUrls = useCallback(() => {
    mediaObjectUrls.current.forEach((url) => URL.revokeObjectURL(url));
    mediaObjectUrls.current = [];
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    try {
      const [productResult, mediaResult, activityResult] = await Promise.all([
        api<{ data: ProductApi }>(`/products/${id}`),
        api<{ data: ProductMedia[] }>(`/products/${id}/media`),
        api<{ data: Activity[] }>(`/products/${id}/activity`),
      ]);
      const hydrated = await Promise.all(mediaResult.data.map(async (item) => ({
        ...item,
        previewUrl: await fetchImageUrl(item.download_url),
      })));
      revokeMediaObjectUrls();
      mediaObjectUrls.current = hydrated.flatMap((item) => (item.previewUrl ? [item.previewUrl] : []));
      setProduct(productResult.data);
      setMedia(hydrated);
      setActivities(activityResult.data);
    } catch (err) {
      setLoadError(err instanceof ApiError ? err.message : t('load_profile_failed'));
    } finally {
      setLoading(false);
    }
  }, [id, revokeMediaObjectUrls, t]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => () => revokeMediaObjectUrls(), [revokeMediaObjectUrls]);
  useEffect(() => {
    setSelectedMediaId((current) => (media.some((item) => item.id === current) ? current : media[0]?.id ?? null));
  }, [media]);
  // الأقسام مبسوطةٌ كلها على الديسكتوب، فالحركات تُجلب مع الصفحة لا عند فتح تبويب.
  useEffect(() => {
    api<{ data: Movement[] }>(`/inventory/${id}/movements`)
      .then((result) => setMovements(result.data))
      .catch(() => setMovements([]));
  }, [id]);

  const selectedMedia = media.find((item) => item.id === selectedMediaId) ?? media[0] ?? null;

  async function copyProduct() {
    if (!product) return;
    try {
      // نسخةٌ بلا رمزٍ ولا باركود (كلاهما فريد) وبلا رصيد ابتدائي — الأسعار
      // تعود إلى الهللات لأن المورد يعيدها بالريال.
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
      router.push('/products');
    } catch (err) {
      showError(err instanceof ApiError ? err.message : t('action_failed'));
      setDeleting(false);
    }
  }

  const actions = useMemo<PageAction[]>(() => [
    { key: 'edit', label: t('edit'), icon: Pencil, href: `/products/${id}/edit`, variant: 'primary' },
    { key: 'receipt', label: t('add_inventory_operation'), icon: Plus, href: `/stock-permits/new?type=receipt&product=${id}`, variant: 'outline', emphasis: 'secondary' },
    { key: 'issue', label: t('issue_stock'), icon: ReceiptText, href: `/stock-permits/new?type=issue&product=${id}`, variant: 'outline', emphasis: 'secondary' },
    { key: 'transfer', label: t('transfer_stock'), icon: ArrowLeftRight, href: `/stock-permits/new?type=transfer&product=${id}`, variant: 'outline', emphasis: 'secondary' },
    { key: 'copy', label: t('copy'), icon: Copy, onClick: () => void copyProduct(), variant: 'outline', emphasis: 'secondary' },
    { key: 'delete', label: t('delete'), icon: Trash2, onClick: () => void deleteProduct(), variant: 'danger', emphasis: 'secondary', disabled: deleting },
    // eslint-disable-next-line react-hooks/exhaustive-deps
  ], [deleting, id, product, t]);

  const sections = useMemo<DetailSection[]>(() => {
    if (!product) return [];
    const units = product.units ?? [];

    return [
      {
        id: 'identity',
        title: t('item_details'),
        content: (
          <div className="grid gap-5 lg:grid-cols-[minmax(0,14rem)_minmax(0,1fr)]">
            <div className="space-y-2">
              {/* بلا صور: سطرٌ مضغوط لا مربّعٌ فارغ بارتفاع الشاشة — أكثر المنتجات
                  بلا صورة، ولا معنى لأن يبتلع فراغُها أول شاشةٍ من الملفّ. */}
              {selectedMedia?.previewUrl ? (
                <div className="relative flex aspect-square items-center justify-center overflow-hidden rounded border border-border bg-background">
                  <Image
                    src={selectedMedia.previewUrl} alt={selectedMedia.original_name} fill priority unoptimized
                    sizes="(max-width: 1024px) 100vw, 14rem" className="object-cover"
                  />
                </div>
              ) : (
                <div className="flex items-center gap-2 rounded border border-border bg-background px-3 py-2.5 text-sm text-muted" role="status">
                  <ImageOff className="h-4 w-4 shrink-0" strokeWidth={1.5} aria-hidden />
                  {t('no_media')}
                </div>
              )}
              {media.length > 1 ? (
                <div className="grid grid-cols-5 gap-2">
                  {media.map((item, index) => (
                    <button
                      key={item.id} type="button"
                      className={`relative aspect-square overflow-hidden rounded border focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${
                        selectedMedia?.id === item.id ? 'border-primary ring-2 ring-primary/25' : 'border-border'
                      }`}
                      aria-label={t('image_preview', { number: index + 1 })}
                      aria-pressed={selectedMedia?.id === item.id}
                      onClick={() => setSelectedMediaId(item.id)}
                    >
                      {item.previewUrl ? (
                        <Image src={item.previewUrl} alt={item.original_name} fill unoptimized sizes="80px" className="object-cover" />
                      ) : (
                        <span className="grid h-full place-items-center text-muted" aria-hidden><ImageOff className="h-4 w-4" /></span>
                      )}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>

            <dl className="grid content-start gap-4 sm:grid-cols-2">
              <Fact label={t('sku')} value={product.sku ?? '—'} mono dir="ltr" />
              <Fact label={t('barcode')} value={product.barcode ?? '—'} mono dir="ltr" />
              <Fact label={t('type')} value={product.type === 'service' ? t('service') : t('good')} />
              <Fact label={t('unit')} value={product.unit || '—'} />
              <Fact label={t('category')} value={product.category || t('unclassified')} />
              <Fact label={t('brand')} value={product.brand || '—'} />
              {units.length > 1 ? (
                <Fact
                  label={t('units')} mono
                  value={units.map((unit) => `${unit.name} ×${unit.factor}`).join(' · ')}
                />
              ) : null}
              {product.name_en ? <Fact label={t('name_en')} value={product.name_en} dir="ltr" /> : null}
            </dl>
          </div>
        ),
      },
      {
        id: 'commercial',
        title: t('pricing_details'),
        content: (
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Fact label={t('sale_price')} value={formatRiyal(product.sale_price)} mono />
            <Fact label={t('purchase_price')} value={formatRiyal(product.purchase_price)} mono />
            <Fact label={t('tax_rate')} value={`${product.tax_rate}%`} mono />
            <Fact
              label={t('min_sale_price')}
              value={product.min_sale_price ? formatRiyal(product.min_sale_price) : '—'} mono
            />
            <Fact
              label={t('discount')}
              value={product.discount != null ? `${product.discount}${product.discount_type === 'amount' ? '' : '%'}` : '—'} mono
            />
            <Fact label={t('profit_margin')} value={product.profit_margin != null ? `${product.profit_margin}%` : '—'} mono />
          </dl>
        ),
      },
      {
        id: 'inventory',
        title: t('inventory_mgmt'),
        content: (
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <Fact label={t('track_inventory')} value={product.track_inventory ? t('tracked') : t('untracked')} />
            <Fact label={t('stock')} value={product.track_inventory ? product.quantity_on_hand : '—'} mono />
            <Fact label={t('avg_cost')} value={formatRiyal(product.avg_cost)} mono />
            <Fact label={t('reorder_level')} value={product.reorder_level != null ? product.reorder_level : '—'} mono />
          </dl>
        ),
      },
      {
        id: 'movements',
        title: t('inventory_movements'),
        count: movements?.length,
        flush: true,
        content: movements === null ? (
          <LoadingState rows={4} surface="bare" label={t('inventory_movements')} />
        ) : movements.length === 0 ? (
          <EmptyState title={ti('empty')} surface="bare" />
        ) : (
          <div className="overflow-x-auto">
            <Table>
              <THead>
                <TR>
                  <TH>{ti('date')}</TH>
                  <TH>{ti('type')}</TH>
                  <TH className="text-end">{ti('qty')}</TH>
                  <TH className="text-end">{ti('avg_cost')}</TH>
                  <TH className="text-end">{ti('balance')}</TH>
                </TR>
              </THead>
              <TBody>
                {movements.map((movement) => (
                  <TR key={movement.id}>
                    <TD className="num text-muted">{movement.movement_date ?? '—'}</TD>
                    <TD><Badge tone={movementTone[movement.type] ?? 'muted'}>{ti(movement.type)}</Badge></TD>
                    <TD className="num text-end">{movement.quantity}</TD>
                    <TD className="num text-end">{formatRiyal(movement.unit_cost)}</TD>
                    <TD className="num text-end font-medium">{movement.balance_quantity}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
        ),
      },
      ...(product.description || product.tags || product.internal_notes
        ? [{
            id: 'notes',
            title: t('section_more'),
            content: (
              <dl className="grid gap-4 sm:grid-cols-2">
                {product.description ? <Fact label={t('description')} value={product.description} /> : null}
                {product.tags ? <Fact label={t('tags')} value={product.tags} /> : null}
                {product.internal_notes ? <Fact label={t('internal_notes')} value={product.internal_notes} /> : null}
              </dl>
            ),
          } as DetailSection]
        : []),
      {
        id: 'activity',
        title: t('activity'),
        count: activities.length,
        content: activities.length === 0 ? (
          <EmptyState title={t('no_activity')} surface="bare" />
        ) : (
          <ol className="space-y-3 border-s border-border ps-4">
            {activities.map((activity) => (
              <li key={activity.id} className="relative">
                <span aria-hidden className="absolute -start-[1.35rem] top-1.5 h-2.5 w-2.5 rounded-full bg-primary" />
                <p className="text-sm font-medium text-text">{activity.action}</p>
                <p className="text-xs text-muted">
                  {t('activity_by', { name: activity.user?.name ?? t('activity_unknown_user') })}
                  {activity.created_at
                    ? ` · ${new Intl.DateTimeFormat(DISPLAY_LOCALE, { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(activity.created_at))}`
                    : ''}
                </p>
              </li>
            ))}
          </ol>
        ),
      },
    ];
  }, [activities, media, movements, product, selectedMedia, t, ti]);

  if (loading) return <LoadingState variant="cards" rows={4} label={t('loading_profile')} />;
  if (loadError || !product) {
    return <ErrorState message={loadError ?? t('load_profile_failed')} onRetry={() => void load()} />;
  }

  return (
    <DetailPage
      backHref="/products"
      backLabel={t('back')}
      title={product.name}
      titleMono={false}
      badges={
        <Badge tone={product.is_active ? 'positive' : 'muted'}>
          {product.is_active ? t('active') : t('inactive')}
        </Badge>
      }
      meta={<span className="num" dir="ltr">{product.sku ?? '—'}</span>}
      actions={actions}
      alert={error ? <FormAlert>{error}</FormAlert> : undefined}
      summaryTitle={t('product_info')}
      summary={
        <DetailSummary
          rows={[
            { label: t('stock'), value: product.track_inventory ? product.quantity_on_hand : '—' },
            { label: t('avg_cost'), value: formatRiyal(product.avg_cost) },
            { label: t('purchase_price'), value: formatRiyal(product.purchase_price) },
            { label: t('sale_price'), value: formatRiyal(product.sale_price), strong: true },
          ]}
        />
      }
      sections={sections}
    />
  );
}
