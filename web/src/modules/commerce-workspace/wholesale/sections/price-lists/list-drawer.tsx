'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { useLocale } from 'next-intl';
import { Trash2 } from 'lucide-react';
import { ErrorState, FormAlert, LoadingState } from '@/components/nebrax';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { useToast } from '@/components/ui/toast';
import { formatRiyal, riyalToMinor } from '@/lib/money';
import { useWholesaleChannel } from '../../channel-context';
import { commonMessages } from '../../messages/common';
import { useResource } from '../../use-resource';
import {
  addPriceListItem,
  fetchPriceList,
  removePriceListItem,
  searchProducts,
  type CustomerDefault,
  type PriceList,
  type ProductChoice,
} from './api';
import { CoveragePanel } from './coverage-panel';
import { priceListsMessages } from './messages';

type Props = {
  list: PriceList | null;
  canWrite: boolean;
  /** `null` = the viewer may not read customers; `[]` = none. */
  customers: CustomerDefault[] | null;
  onClose: () => void;
  onChanged: () => void;
  onEdit: (list: PriceList) => void;
};

export function ListDrawer({ list, canWrite, customers, onClose, onChanged, onEdit }: Props) {
  const locale = useLocale();
  const { t } = priceListsMessages.forLocale(locale);
  const common = commonMessages.forLocale(locale);
  const { store } = useWholesaleChannel();
  const detail = useResource(() => fetchPriceList(list!.id), [list?.id], { enabled: list !== null });

  return (
    <Sheet open={list !== null} onOpenChange={(next) => !next && onClose()}>
      <SheetContent closeLabel={common.t('close')} className="overflow-y-auto sm:max-w-xl">
        <div className="space-y-4 p-4">
          <div className="flex flex-wrap items-start justify-between gap-2 pe-10">
            <div className="min-w-0">
              <SheetTitle className="text-base font-semibold text-text"><bdi>{list?.name}</bdi></SheetTitle>
              <SheetDescription className="text-xs text-muted">{list?.description ?? t('tableTitle')}</SheetDescription>
            </div>
            {list ? <Badge tone={list.is_active ? 'positive' : 'muted'}>{list.is_active ? t('active') : t('inactive')}</Badge> : null}
          </div>
          {list && canWrite ? (
            <Button type="button" variant="outline" className="min-h-11" onClick={() => onEdit(list)}>{t('formEdit')}</Button>
          ) : null}

          {detail.state.status === 'loading' ? (
            <LoadingState variant="cards" rows={2} />
          ) : detail.state.status === 'error' ? (
            <ErrorState message={t('loadError')} onRetry={detail.reload} retryLabel={common.t('retry')} />
          ) : list ? (
            <>
              <ItemsSection
                list={list}
                items={detail.state.data.items ?? []}
                canWrite={canWrite}
                onChanged={() => {
                  detail.reload();
                  onChanged();
                }}
              />
              {store ? (
                <CoveragePanel
                  key={`${store.id}:${list.id}:${detail.state.data.items?.length ?? 0}`}
                  storeId={store.id}
                  itemProductIds={(detail.state.data.items ?? []).map((item) => item.product_id)}
                />
              ) : null}
              <CustomersSection list={list} customers={customers} />
            </>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}

function ItemsSection({ list, items, canWrite, onChanged }: { list: PriceList; items: NonNullable<PriceList['items']>; canWrite: boolean; onChanged: () => void }) {
  const locale = useLocale();
  const { t } = priceListsMessages.forLocale(locale);
  const confirm = useConfirm();
  const toast = useToast();

  async function remove(item: (typeof items)[number]) {
    const ok = await confirm({
      title: t('removeItem'),
      message: t('removeItemConfirm', { name: item.product_name ?? '—' }),
      confirmLabel: t('removeItem'),
      tone: 'danger',
    });
    if (!ok) return;
    try {
      await removePriceListItem(list.id, item.id);
      toast.success(t('itemRemoved'));
      onChanged();
    } catch {
      toast.error(t('itemFailed'));
    }
  }

  return (
    <section aria-label={t('drawerItems')} className="space-y-2">
      <h3 className="text-sm font-medium text-text">
        {t('drawerItems')} <span className="num text-xs text-muted">({items.length})</span>
      </h3>
      {items.length === 0 ? (
        <p className="text-sm text-muted">{t('drawerNoItems')}</p>
      ) : (
        <ul className="divide-y divide-border rounded border border-border">
          {items.map((item) => (
            <li key={item.id} className="flex items-center gap-2 p-2.5 text-sm">
              <div className="min-w-0 flex-1">
                <div className="truncate font-medium text-text"><bdi>{item.product_name ?? '—'}</bdi></div>
                <div className="text-xs text-muted">
                  {item.product_sku ? <span className="num me-2">{item.product_sku}</span> : null}
                  {item.unit_name ? item.unit_name : t('baseUnit')}
                </div>
              </div>
              <span className="num shrink-0 font-medium">{formatRiyal(item.price)}</span>
              {canWrite ? (
                <Button type="button" size="sm" variant="ghost" className="min-h-11 min-w-11" aria-label={`${t('removeItem')}: ${item.product_name ?? ''}`} onClick={() => void remove(item)}>
                  <Trash2 className="h-4 w-4" aria-hidden="true" />
                </Button>
              ) : null}
            </li>
          ))}
        </ul>
      )}
      {canWrite ? <AddItemForm listId={list.id} onAdded={onChanged} /> : null}
    </section>
  );
}

function AddItemForm({ listId, onAdded }: { listId: string; onAdded: () => void }) {
  const locale = useLocale();
  const { t } = priceListsMessages.forLocale(locale);
  const toast = useToast();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ProductChoice[] | null>(null);
  const [product, setProduct] = useState<ProductChoice | null>(null);
  const [unit, setUnit] = useState('');
  const [price, setPrice] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    const term = query.trim();
    if (product || term.length < 2) {
      setResults(null);
      return;
    }
    let live = true;
    const timer = window.setTimeout(() => {
      searchProducts(term).then(
        (rows) => live && setResults(rows),
        () => live && setResults([]),
      );
    }, 300);
    return () => {
      live = false;
      window.clearTimeout(timer);
    };
  }, [query, product]);

  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (!product || busy) return;
    const minor = riyalToMinor(price);
    if (!Number.isFinite(minor) || minor < 0 || price.trim() === '') {
      setError(t('priceInvalid'));
      return;
    }
    setBusy(true);
    setError(null);
    try {
      await addPriceListItem(listId, { product_id: product.id, unit_name: unit === '' ? null : unit, price: minor });
      toast.success(t('itemAdded'));
      setProduct(null);
      setQuery('');
      setUnit('');
      setPrice('');
      onAdded();
    } catch (failure) {
      setError(failure instanceof Error && failure.message ? failure.message : t('itemFailed'));
    } finally {
      setBusy(false);
    }
  }

  const units = product?.units ?? [];

  return (
    <form onSubmit={(event) => void submit(event)} className="space-y-2 rounded border border-dashed border-border p-3" noValidate>
      <h4 className="text-xs font-medium text-muted">{t('addItem')}</h4>
      <div className="space-y-1.5">
        <Label htmlFor="pl-product">{t('productSearch')}</Label>
        <Input
          id="pl-product"
          type="search"
          value={product ? product.name : query}
          placeholder={t('productSearchHint')}
          onChange={(event) => {
            setProduct(null);
            setUnit('');
            setQuery(event.target.value);
          }}
          autoComplete="off"
        />
        {results !== null && !product ? (
          results.length === 0 ? (
            <p className="text-xs text-muted">{t('productNone')}</p>
          ) : (
            <ul role="listbox" aria-label={t('productSearch')} className="max-h-44 divide-y divide-border overflow-y-auto rounded border border-border">
              {results.map((row) => (
                <li key={row.id} role="option" aria-selected={false}>
                  <button type="button" className="flex min-h-11 w-full items-center justify-between gap-2 px-2.5 text-start text-sm hover:bg-primary-soft focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40" onClick={() => setProduct(row)}>
                    <bdi className="truncate">{row.name}</bdi>
                    {row.sku ? <span className="num shrink-0 text-xs text-muted">{row.sku}</span> : null}
                  </button>
                </li>
              ))}
            </ul>
          )
        ) : null}
      </div>
      {product ? (
        <div className="grid gap-2 sm:grid-cols-2">
          {units.length > 1 ? (
            <div className="space-y-1.5">
              <Label htmlFor="pl-unit">{t('pickUnit')}</Label>
              <Select id="pl-unit" value={unit} onChange={(event) => setUnit(event.target.value)}>
                <option value="">{t('baseUnit')}</option>
                {units.slice(1).map((candidate) => (
                  <option key={candidate.name} value={candidate.name}>{candidate.name}</option>
                ))}
              </Select>
            </div>
          ) : null}
          <div className="space-y-1.5">
            <Label htmlFor="pl-price">{t('priceRiyal')}</Label>
            <Input id="pl-price" inputMode="decimal" value={price} onChange={(event) => setPrice(event.target.value)} aria-invalid={error ? true : undefined} />
          </div>
        </div>
      ) : null}
      {error ? <FormAlert tone="error">{error}</FormAlert> : null}
      <Button type="submit" className="min-h-11" disabled={!product || busy}>{t('add')}</Button>
    </form>
  );
}

function CustomersSection({ list, customers }: { list: PriceList; customers: CustomerDefault[] | null }) {
  const locale = useLocale();
  const { t } = priceListsMessages.forLocale(locale);
  const using = (customers ?? []).filter((customer) => customer.default_price_list_id === list.id);

  return (
    <section aria-label={t('drawerCustomers')} className="space-y-2">
      <h3 className="text-sm font-medium text-text">{t('drawerCustomers')}</h3>
      <p className="text-xs leading-relaxed text-muted">{t('customersNote')}</p>
      {customers === null ? (
        <p className="text-sm text-muted">{t('customersForbidden')}</p>
      ) : using.length === 0 ? (
        <p className="text-sm text-muted">{t('drawerNoCustomers')}</p>
      ) : (
        <ul className="divide-y divide-border rounded border border-border">
          {using.map((customer) => (
            <li key={customer.id} className="flex items-center justify-between gap-2 p-2.5 text-sm">
              <bdi className="min-w-0 truncate">{customer.name}</bdi>
              <Button asChild variant="ghost" size="sm" className="min-h-11">
                <Link href={`/partners/${customer.id}/edit`}>{t('editCustomer')}</Link>
              </Button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
