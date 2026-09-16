'use client';
import { formatDateTime } from '@/lib/formatting';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight, ArrowLeftRight, Copy, MoreVertical, Plus, ReceiptText, Trash2 } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { formatRiyal } from '@/lib/money';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dropdown, DropdownItem } from '@/components/ui/dropdown';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Tabs, TabPanel, type TabDef } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { type Product as ProductFormProduct } from '@/components/products/product-dialog';
import { ProductWorkspace } from '@/components/products/product-workspace';

type Product = ProductFormProduct & {
  units: Array<{ name: string; factor: number }>;
};

type Activity = { id: string; action: string; created_at: string | null; user: { id: string; name: string } | null };
type Movement = { id: string; type: string; quantity: number; unit_cost: string; total_cost: string; balance_quantity: number; movement_date: string | null; notes: string | null };

const movementTone: Record<string, 'positive' | 'warning' | 'muted'> = { in: 'positive', out: 'warning', adjustment: 'muted' };

export default function ProductProfilePage() {
  const params = useParams<{ id: string }>();
  const id = params.id;
  const t = useTranslations('products');
  const ti = useTranslations('inventory');
  const { success, error: showError } = useToast();
  const [product, setProduct] = useState<Product | null>(null);
  const [activities, setActivities] = useState<Activity[]>([]);
  const [movements, setMovements] = useState<Movement[] | null>(null);
  const [activeTab, setActiveTab] = useState('info');
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [productResult, activityResult] = await Promise.all([
        api<{ data: Product }>(`/products/${id}`),
        api<{ data: Activity[] }>(`/products/${id}/activity`),
      ]);
      setProduct(productResult.data);
      setActivities(activityResult.data);
    } catch (err) {
      setError(err instanceof ApiError ? err.message : t('load_profile_failed'));
    } finally {
      setLoading(false);
    }
  }, [id, t]);

  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    if (activeTab !== 'movements' || movements !== null) return;
    api<{ data: Movement[] }>(`/inventory/${id}/movements`)
      .then((result) => setMovements(result.data))
      .catch(() => setMovements([]));
  }, [activeTab, id, movements]);

  const tabs = useMemo<TabDef[]>(() => [
    { id: 'info', label: t('product_info') },
    { id: 'movements', label: t('inventory_movements') },
    { id: 'timeline', label: t('timeline') },
    { id: 'activity', label: t('activity'), count: activities.length },
  ], [activities.length, t]);

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
        <Button asChild variant="ghost" size="icon" aria-label={t('back')}><Link href="/products"><ArrowRight className="h-4 w-4" /></Link></Button>
        <div className="min-w-0">
          <p className="text-xs font-medium text-muted">{t('profile_title')}</p>
          <h1 className="truncate text-xl font-semibold text-text">{product.name}</h1>
          <p className="num text-sm text-muted">{product.sku ?? '—'}</p>
        </div>
        <div className="ms-auto flex items-center gap-2">
          <Badge tone={product.is_active ? 'positive' : 'muted'}>{product.is_active ? t('active') : t('inactive')}</Badge>
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

      <section className="grid gap-3 sm:grid-cols-4" aria-label={t('product_info')}>
        <Card><CardContent className="p-4"><p className="text-xs text-muted">{t('stock')}</p><p className="mt-1 text-lg font-semibold num text-text">{product.track_inventory ? product.quantity_on_hand : '—'}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted">{t('avg_cost')}</p><p className="mt-1 text-lg font-semibold num text-text">{formatRiyal(product.avg_cost)}</p></CardContent></Card>
        <Card><CardContent className="p-4"><p className="text-xs text-muted">{t('sale_price')}</p><p className="mt-1 text-lg font-semibold num text-text">{formatRiyal(product.sale_price)}</p></CardContent></Card>
        <Card>
          <CardContent className="p-4">
            <p className="text-xs text-muted">{t('units')}</p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {product.units.length === 0 ? (
                <Badge tone="muted">{product.unit}</Badge>
              ) : product.units.map((unit) => (
                <Badge key={unit.name} tone={unit.factor === 1 ? 'neutral' : 'muted'}>
                  {unit.name}{unit.factor === 1 ? ` (${t('unit_base_badge')})` : ` ×${unit.factor}`}
                </Badge>
              ))}
            </div>
          </CardContent>
        </Card>
      </section>

      <Tabs tabs={tabs} value={activeTab} onChange={setActiveTab} />

      {activeTab === 'info' && (
        <TabPanel id="info">
          <div className="space-y-5">
            {/* المعلومات الأساسية والتسعير والمحاسبة والمخزون والوحدات/الباركود
                المتعدّد/السعر لكل وحدة والخيارات/المتغيّرات والوسائط والنشر
                التجاري — كلّها قابلة للتحرير مباشرةً عبر مساحة العمل
                المشتركة، بلا نافذة منبثقة ولا تبويبٌ منفصل (PR-PROD-UX-1/2/3/4؛
                `ProductDialog` يبقى قائماً للإضافة السريعة فقط). */}
            <ProductWorkspace
              mode="edit"
              product={product}
              onUpdated={() => void load()}
            />
          </div>
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
              {activities.length === 0 ? <p className="text-sm text-muted">{t('no_activity')}</p> : <ol className="space-y-3 border-s border-border ps-4">{activities.map((activity) => <li key={activity.id} className="relative"><span aria-hidden className="absolute -start-[1.35rem] top-1.5 h-2.5 w-2.5 rounded-full bg-primary" /><p className="font-medium text-text">{activity.action}</p><p className="text-xs text-muted">{t('activity_by', { name: activity.user?.name ?? t('activity_unknown_user') })}{activity.created_at ? ` · ${formatDateTime(activity.created_at)}` : ''}</p></li>)}</ol>}
            </CardContent>
          </Card>
        </TabPanel>
      )}
    </div>
  );
}
