'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight, Plus, Save, Tags, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Combobox, type ComboOption } from '@/components/ui/combobox';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { riyalToMinor } from '@/lib/money';

interface Unit { name: string; factor: number }
interface Product { id: string; name: string; sku?: string | null; is_active: boolean; units?: Unit[] }
interface PriceListItem {
  id: string; product_id: string; product_name?: string | null; product_sku?: string | null;
  unit_name: string; price: string;
}
interface PriceList {
  id: string; name: string; description: string | null; is_active: boolean; items_count?: number; items?: PriceListItem[];
}

const blankDraft = () => ({ name: '', description: '', is_active: true });

/** قوائم أسعار صريحة يختارها البائع داخل الفاتورة؛ لا تعيد تفسير سطرٍ محفوظ. */
export default function PriceListsPage() {
  const t = useTranslations('priceLists');
  const tc = useTranslations('common');
  const router = useRouter();
  const { success } = useToast();
  const [lists, setLists] = useState<PriceList[] | null>(null);
  const [products, setProducts] = useState<Product[]>([]);
  const [selected, setSelected] = useState<PriceList | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [draft, setDraft] = useState(blankDraft);
  const [loadingDetail, setLoadingDetail] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [itemProductId, setItemProductId] = useState('');
  const [itemUnit, setItemUnit] = useState('');
  const [itemPrice, setItemPrice] = useState('');
  const [savingItem, setSavingItem] = useState(false);

  const loadLists = useCallback(async () => {
    try {
      const response = await api<{ data: PriceList[] }>('/price-lists');
      setLists(response.data);
    } catch {
      setLists([]);
      setError(t('load_failed'));
    }
  }, [t]);

  const openList = useCallback(async (id: string) => {
    setLoadingDetail(true);
    setError(null);
    try {
      const response = await api<{ data: PriceList }>(`/price-lists/${id}`);
      setSelected(response.data);
      setIsCreating(false);
      setDraft({
        name: response.data.name,
        description: response.data.description ?? '',
        is_active: response.data.is_active,
      });
      setItemProductId('');
      setItemUnit('');
      setItemPrice('');
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : t('load_failed'));
    } finally {
      setLoadingDetail(false);
    }
  }, [t]);

  useEffect(() => {
    void loadLists();
    api<{ data: Product[] }>('/products')
      .then((response) => setProducts(response.data.filter((product) => product.is_active)))
      .catch(() => {});
  }, [loadLists]);

  const productOptions = useMemo<ComboOption[]>(() => products.map((product) => ({
    value: product.id,
    label: product.name,
    sub: product.sku ?? undefined,
  })), [products]);
  const itemProduct = products.find((product) => product.id === itemProductId);
  const unitOptions = itemProduct?.units?.length
    ? itemProduct.units
    : itemProduct ? [{ name: t('base_unit'), factor: 1 }] : [];

  function createList() {
    setSelected(null);
    setIsCreating(true);
    setDraft(blankDraft());
    setItemProductId('');
    setItemUnit('');
    setItemPrice('');
    setError(null);
  }

  async function saveList() {
    if (!draft.name.trim() || saving) return;
    setSaving(true);
    setError(null);
    const body = { name: draft.name.trim(), description: draft.description.trim() || null, is_active: draft.is_active };
    try {
      const response = selected
        ? await api<{ data: PriceList }>(`/price-lists/${selected.id}`, { method: 'PUT', body })
        : await api<{ data: PriceList }>('/price-lists', { method: 'POST', body });
      success(t('saved'));
      await loadLists();
      await openList(response.data.id);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : t('save_failed'));
    } finally {
      setSaving(false);
    }
  }

  async function deleteList() {
    if (!selected || !window.confirm(t('delete_confirm'))) return;
    setError(null);
    try {
      await api(`/price-lists/${selected.id}`, { method: 'DELETE' });
      success(t('deleted'));
      setSelected(null);
      setIsCreating(false);
      await loadLists();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : t('delete_failed'));
    }
  }

  async function addItem() {
    if (!selected || !itemProductId || itemPrice.trim() === '' || savingItem) return;
    const price = riyalToMinor(itemPrice);
    if (!Number.isFinite(price)) {
      setError(t('invalid_price'));
      return;
    }
    setSavingItem(true);
    setError(null);
    try {
      await api(`/price-lists/${selected.id}/items`, {
        method: 'POST',
        body: { product_id: itemProductId, unit_name: itemUnit || null, price },
      });
      success(t('item_saved'));
      setItemProductId('');
      setItemUnit('');
      setItemPrice('');
      await openList(selected.id);
      await loadLists();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : t('item_save_failed'));
    } finally {
      setSavingItem(false);
    }
  }

  async function deleteItem(item: PriceListItem) {
    if (!selected || !window.confirm(t('remove_price_confirm'))) return;
    setError(null);
    try {
      await api(`/price-lists/${selected.id}/items/${item.id}`, { method: 'DELETE' });
      success(t('item_deleted'));
      await openList(selected.id);
      await loadLists();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.message : t('item_delete_failed'));
    }
  }

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-3">
        <Button variant="ghost" size="icon" onClick={() => router.push('/sales-settings')} aria-label={tc('back')}>
          <ArrowRight className="h-4 w-4" strokeWidth={1.7} />
        </Button>
        <div className="min-w-0">
          <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">{t('description')}</p>
        </div>
        <Button className="ms-auto" onClick={createList}><Plus className="h-4 w-4" strokeWidth={1.7} />{t('new')}</Button>
      </div>

      {error && <p className="rounded-md border border-negative/25 bg-negative/10 px-3 py-2 text-sm text-negative" role="alert">{error}</p>}

      <div className="grid gap-5 lg:grid-cols-[19rem_minmax(0,1fr)]">
        <Card className="h-fit">
          <CardHeader><CardTitle className="flex items-center gap-2"><Tags className="h-4 w-4 text-primary" strokeWidth={1.8} />{t('title')}</CardTitle></CardHeader>
          <CardContent className="space-y-2">
            {!lists ? <Skeleton className="h-28 w-full" /> : lists.length === 0 ? <p className="py-6 text-center text-sm text-muted">{t('empty')}</p> : lists.map((list) => (
              <button key={list.id} type="button" onClick={() => void openList(list.id)} className={`w-full rounded-md border p-3 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40 ${selected?.id === list.id ? 'border-primary bg-primary-soft' : 'border-border bg-surface hover:bg-background'}`}>
                <span className="block truncate text-sm font-medium text-text">{list.name}</span>
                <span className="mt-1 flex items-center justify-between gap-2 text-xs text-muted"><span>{list.is_active ? t('active') : t('inactive')}</span><span className="num">{list.items_count ?? 0}</span></span>
              </button>
            ))}
          </CardContent>
        </Card>

        <div className="min-w-0 space-y-5">
          {!selected && !isCreating && !loadingDetail ? <Card><CardContent className="py-12 text-center text-sm text-muted">{t('choose_list')}</CardContent></Card> : loadingDetail ? <Skeleton className="h-72 w-full" /> : <>
            <Card>
              <CardHeader className="flex flex-row items-center justify-between gap-3"><CardTitle>{selected ? selected.name : t('new')}</CardTitle>{selected && <Button type="button" variant="ghost" size="sm" onClick={() => void deleteList()}><Trash2 className="h-4 w-4 text-negative" strokeWidth={1.7} />{t('delete')}</Button>}</CardHeader>
              <CardContent className="space-y-4">
                <div className="grid gap-4 sm:grid-cols-2">
                  <div className="space-y-1.5"><Label htmlFor="price-list-name">{t('list_name')}</Label><Input id="price-list-name" value={draft.name} maxLength={255} onChange={(event) => setDraft((current) => ({ ...current, name: event.target.value }))} /></div>
                  <div className="space-y-1.5"><Label htmlFor="price-list-status">{t('status')}</Label><Select id="price-list-status" value={draft.is_active ? 'active' : 'inactive'} onChange={(event) => setDraft((current) => ({ ...current, is_active: event.target.value === 'active' }))}><option value="active">{t('active')}</option><option value="inactive">{t('inactive')}</option></Select></div>
                </div>
                <div className="space-y-1.5"><Label htmlFor="price-list-description">{t('list_description')}</Label><textarea id="price-list-description" className="min-h-20 w-full rounded-md border border-border bg-surface px-3 py-2 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-primary/40" value={draft.description} maxLength={2000} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} /></div>
                <div className="flex justify-end border-t border-border pt-3"><Button disabled={!draft.name.trim() || saving} onClick={() => void saveList()}><Save className="h-4 w-4" strokeWidth={1.7} />{saving ? t('saving') : t('save')}</Button></div>
              </CardContent>
            </Card>

            {selected && <Card>
              <CardHeader><CardTitle>{t('items')}</CardTitle><p className="mt-1 text-sm leading-6 text-muted">{t('items_hint')}</p></CardHeader>
              <CardContent className="space-y-4">
                <div className="grid items-end gap-3 rounded-md border border-border bg-background p-3 md:grid-cols-[minmax(0,1fr)_10rem_10rem_auto]">
                  <div className="space-y-1.5"><Label>{t('product')}</Label><Combobox value={itemProductId} onChange={(value) => { setItemProductId(value); setItemUnit(''); }} options={productOptions} placeholder={t('choose_product')} searchPlaceholder={t('search_product')} emptyText={t('no_product')} /></div>
                  <div className="space-y-1.5"><Label htmlFor="price-list-unit">{t('unit')}</Label><Select id="price-list-unit" value={itemUnit} disabled={!itemProduct} onChange={(event) => setItemUnit(event.target.value)}><option value="">{t('base_unit')}</option>{unitOptions.filter((unit) => unit.factor !== 1).map((unit) => <option key={unit.name} value={unit.name}>{unit.name}</option>)}</Select></div>
                  <div className="space-y-1.5"><Label htmlFor="price-list-price">{t('price')}</Label><Input id="price-list-price" className="num text-end" inputMode="decimal" value={itemPrice} onChange={(event) => setItemPrice(event.target.value)} /></div>
                  <Button type="button" variant="outline" disabled={!selected.is_active || !itemProductId || itemPrice.trim() === '' || savingItem} onClick={() => void addItem()}><Plus className="h-4 w-4" strokeWidth={1.7} />{t('add_price')}</Button>
                </div>

                {!selected.items?.length ? <p className="rounded-md border border-dashed border-border py-6 text-center text-sm text-muted">{t('item_empty')}</p> : <div className="overflow-x-auto"><table className="w-full min-w-[34rem] text-sm"><thead className="border-b border-border bg-background text-start text-xs text-muted"><tr><th className="px-3 py-2.5 font-medium">{t('product')}</th><th className="px-3 py-2.5 font-medium">{t('unit')}</th><th className="px-3 py-2.5 text-end font-medium">{t('price')}</th><th className="w-12 px-3 py-2.5" /></tr></thead><tbody className="divide-y divide-border">{selected.items.map((item) => <tr key={item.id}><td className="px-3 py-3 text-text"><p>{item.product_name ?? '—'}</p>{item.product_sku && <p className="num mt-0.5 text-xs text-muted">{item.product_sku}</p>}</td><td className="px-3 py-3 text-muted">{item.unit_name || t('base_unit')}</td><td className="num px-3 py-3 text-end text-text">{item.price}</td><td className="px-3 py-3"><Button type="button" variant="ghost" size="icon" aria-label={t('remove_price')} onClick={() => void deleteItem(item)}><Trash2 className="h-4 w-4 text-negative" strokeWidth={1.7} /></Button></td></tr>)}</tbody></table></div>}
              </CardContent>
            </Card>}
          </>}
        </div>
      </div>
    </div>
  );
}
