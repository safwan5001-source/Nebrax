'use client';

import { useEffect, useRef, useState } from 'react';
import { useLocale } from 'next-intl';
import { PackageSearch } from 'lucide-react';
import { EmptyState, ErrorState, LoadingState, MobileRecordItem } from '@/components/nebrax';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Sheet, SheetContent, SheetDescription, SheetTitle } from '@/components/ui/sheet';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { formatOrderMoney } from '@/modules/commerce-workspace/orders/order-display';
import {
  listWorkspaceProducts,
  showWorkspaceProduct,
  type WorkspaceProductDetail,
  type WorkspaceProductSummary,
} from '@/modules/commerce-workspace/workspace-products';
import { commonMessages } from '../../messages/common';
import { catalogMessages } from './messages';

const PAGE_SIZE = 20;

function StockBadge({ value }: { value: boolean | null | undefined }) {
  const { t } = catalogMessages.forLocale(useLocale());
  if (value === true) return <Badge tone="positive">{t('stockIn')}</Badge>;
  if (value === false) return <Badge tone="negative">{t('stockOut')}</Badge>;
  return <Badge tone="muted">{t('stockUnknown')}</Badge>;
}

const money = (minor: number | null | undefined, currency: string | undefined) =>
  typeof minor === 'number' ? formatOrderMoney({ amount_minor: minor, currency: currency ?? 'SAR' }) : '—';

/** Eligible (active + published on this channel) products with the server-computed price and stock flag. Read-only. */
export function AvailabilityPanel({ storeId }: { storeId: string }) {
  const locale = useLocale();
  const { t } = catalogMessages.forLocale(locale);
  const common = commonMessages.forLocale(locale);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [page, setPage] = useState(1);
  const [rows, setRows] = useState<WorkspaceProductSummary[]>([]);
  const [hasMore, setHasMore] = useState(false);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [open, setOpen] = useState<WorkspaceProductSummary | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const [reloadKey, setReloadKey] = useState(0);
  useEffect(() => {
    const id = ++seq.current;
    setState('loading');
    void listWorkspaceProducts(storeId, { search: search || undefined, page, perPage: PAGE_SIZE }).then((outcome) => {
      if (id !== seq.current) return;
      if (!outcome.ok) {
        setState('error');
        return;
      }
      setRows(outcome.data);
      setHasMore(outcome.hasMore);
      setState('ready');
    });
  }, [storeId, search, page, reloadKey]);

  return (
    <div className="space-y-3">
      <p className="text-xs leading-relaxed text-muted">{t('availabilityNote')}</p>
      <Input type="search" aria-label={t('search')} placeholder={t('search')} value={searchInput} onChange={(event) => setSearchInput(event.target.value)} className="sm:max-w-sm" />

      {state === 'loading' && rows.length === 0 ? (
        <LoadingState variant="table" rows={5} />
      ) : state === 'error' ? (
        <ErrorState message={common.t('loadError')} onRetry={() => setReloadKey((key) => key + 1)} retryLabel={common.t('retry')} />
      ) : rows.length === 0 ? (
        <EmptyState icon={PackageSearch} title={search ? t('emptyFilteredTitle') : t('availabilityEmptyTitle')} description={search ? t('emptyFilteredBody') : t('availabilityEmptyBody')} />
      ) : (
        <div className="rounded border border-border bg-surface" aria-busy={state === 'loading'}>
          <div className="hidden md:block">
            <Table>
              <THead>
                <TR>
                  <TH scope="col" className="px-3 py-2 text-start font-medium">{t('colProduct')}</TH>
                  <TH scope="col" className="px-3 py-2 text-end font-medium">{t('colPrice')}</TH>
                  <TH scope="col" className="px-3 py-2 text-start font-medium">{t('colStock')}</TH>
                </TR>
              </THead>
              <TBody>
                {rows.map((row) => (
                  <TR key={row.id}>
                    <TD className="px-3 py-1">
                      <button type="button" onClick={() => setOpen(row)} className="min-h-11 text-start font-medium text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                        <bdi>{row.name}</bdi>
                      </button>
                      {row.isVariantManaged ? <Badge tone="muted" className="ms-2">{t('variantsBadge')}</Badge> : null}
                    </TD>
                    <TD className="num px-3 py-2 text-end">{money(row.priceAmountMinor, row.currency)}</TD>
                    <TD className="px-3 py-2"><StockBadge value={row.inStock} /></TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
          <ul className="divide-y divide-border md:hidden">
            {rows.map((row) => (
              <li key={row.id}>
                <button type="button" onClick={() => setOpen(row)} className="block w-full text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/40">
                  <MobileRecordItem record={{ title: row.name, amount: money(row.priceAmountMinor, row.currency), status: <StockBadge value={row.inStock} /> }} />
                </button>
              </li>
            ))}
          </ul>
          <div className="flex items-center justify-between gap-2 border-t border-border p-3">
            <Button type="button" variant="outline" className="min-h-11" disabled={page <= 1 || state === 'loading'} onClick={() => setPage((value) => value - 1)}>
              {t('prevPage')}
            </Button>
            <span className="num text-xs text-muted">{t('pageLabel', { page })}</span>
            <Button type="button" variant="outline" className="min-h-11" disabled={!hasMore || state === 'loading'} onClick={() => setPage((value) => value + 1)}>
              {t('nextPage')}
            </Button>
          </div>
        </div>
      )}

      <ProductDrawer storeId={storeId} product={open} onClose={() => setOpen(null)} />
    </div>
  );
}

function ProductDrawer({ storeId, product, onClose }: { storeId: string; product: WorkspaceProductSummary | null; onClose: () => void }) {
  const locale = useLocale();
  const { t } = catalogMessages.forLocale(locale);
  const [detail, setDetail] = useState<{ status: 'loading' } | { status: 'error' } | { status: 'ready'; data: WorkspaceProductDetail }>({ status: 'loading' });

  useEffect(() => {
    if (!product) return;
    let live = true;
    setDetail({ status: 'loading' });
    void showWorkspaceProduct(storeId, product.id).then((outcome) => {
      if (live) setDetail(outcome.ok ? { status: 'ready', data: outcome.data } : { status: 'error' });
    });
    return () => {
      live = false;
    };
  }, [storeId, product]);

  return (
    <Sheet open={product !== null} onOpenChange={(next) => !next && onClose()}>
      <SheetContent closeLabel={t('detailTitle')} className="overflow-y-auto sm:max-w-lg">
        <div className="space-y-4 p-4">
          <div>
            <SheetTitle className="text-base font-semibold text-text"><bdi>{product?.name}</bdi></SheetTitle>
            <SheetDescription className="text-xs text-muted">{t('detailTitle')}</SheetDescription>
          </div>
          {detail.status === 'loading' ? (
            <LoadingState variant="cards" rows={2} />
          ) : detail.status === 'error' ? (
            <ErrorState message={t('detailLoadError')} />
          ) : (
            <div className="space-y-4">
              <dl className="grid grid-cols-2 gap-3 text-sm">
                <div>
                  <dt className="text-xs text-muted">{t('detailSku')}</dt>
                  <dd className="num">{detail.data.sku ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">{t('detailCategory')}</dt>
                  <dd>{detail.data.categoryName ?? '—'}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">{t('detailPrice')}</dt>
                  <dd className="num">{money(detail.data.priceAmountMinor, detail.data.currency)}</dd>
                </div>
                <div>
                  <dt className="text-xs text-muted">{t('colStock')}</dt>
                  <dd><StockBadge value={detail.data.inStock} /></dd>
                </div>
              </dl>
              <section aria-label={t('detailVariants')}>
                <h3 className="mb-1.5 text-xs font-medium text-muted">{t('detailVariants')}</h3>
                {detail.data.variants && detail.data.variants.length > 0 ? (
                  <ul className="divide-y divide-border rounded border border-border">
                    {detail.data.variants.map((variant) => (
                      <li key={variant.id} className="flex items-center justify-between gap-2 p-2.5 text-sm">
                        <span className="num min-w-0 truncate">{variant.sku ?? '—'}</span>
                        <span className="num shrink-0">{money(variant.priceAmountMinor, variant.currency)}</span>
                        <StockBadge value={variant.inStock} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">{t('detailNoVariants')}</p>
                )}
              </section>
            </div>
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
