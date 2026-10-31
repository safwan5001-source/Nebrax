'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useLocale } from 'next-intl';
import { PackageOpen } from 'lucide-react';
import { EmptyState, ErrorState, LoadingState, MobileRecordItem, Pagination } from '@/components/nebrax';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { useCan } from '@/lib/use-can';
import type { ProductPublicationListPage, PublicationStatusFilter } from '@/modules/products/publication';
import { loadStoreCatalogPage, setStorePublication } from './api';
import { commonMessages } from '../../messages/common';
import { catalogMessages } from './messages';

const PER_PAGE_OPTIONS = [10, 25, 50];

/** Product selection + channel visibility for ONE store. Writes need `products.manage` (the server's own gate). */
export function PublicationPanel({ storeId, storeName, onChanged }: { storeId: string; storeName: string; onChanged: () => void }) {
  const locale = useLocale();
  const { t } = catalogMessages.forLocale(locale);
  const common = commonMessages.forLocale(locale);
  const { can } = useCan();
  const confirm = useConfirm();
  const toast = useToast();
  const canWrite = can('products.manage');

  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState<PublicationStatusFilter>('all');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [result, setResult] = useState<ProductPublicationListPage | null>(null);
  const [state, setState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [busyId, setBusyId] = useState<string | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const load = useCallback(() => {
    const id = ++seq.current;
    setState('loading');
    loadStoreCatalogPage(storeId, { search, status, page, perPage }).then(
      (next) => {
        if (id !== seq.current) return;
        setResult(next);
        setState('ready');
      },
      () => {
        if (id !== seq.current) return;
        setResult(null);
        setState('error');
      },
    );
  }, [storeId, search, status, page, perPage]);

  useEffect(() => load(), [load]);
  // A write resolves long after the click: `toggle` must refresh with the filters/page on screen NOW, not the ones its
  // closure captured when the click happened (a stale loader would fetch old filters and win the sequence race).
  const latestLoad = useRef(load);
  latestLoad.current = load;

  async function toggle(item: ProductPublicationListPage['items'][number], publish: boolean) {
    if (busyId) return;
    const name = item.name;
    const ok = await confirm({
      title: publish ? t('publishConfirmTitle') : t('unpublishConfirmTitle'),
      message: t(publish ? 'publishConfirmMessage' : 'unpublishConfirmMessage', { name, store: storeName }),
      confirmLabel: publish ? t('publish') : t('unpublish'),
      tone: publish ? 'default' : 'danger',
    });
    if (!ok) return;
    setBusyId(item.id);
    try {
      await setStorePublication(item.id, storeId, publish);
      toast.success(t(publish ? 'publishDone' : 'unpublishDone'));
      latestLoad.current();
      onChanged();
    } catch {
      toast.error(t('writeFailed'));
    } finally {
      setBusyId(null);
    }
  }

  const items = result?.items ?? [];
  const filtered = search !== '' || status !== 'all';

  const visibility = (item: (typeof items)[number]) => {
    const published = item.stores.some((store) => store.id === storeId && store.isPublished);
    return published;
  };
  const action = (item: (typeof items)[number]) => {
    if (!canWrite) return null;
    const published = visibility(item);
    return (
      <Button
        type="button"
        size="sm"
        variant={published ? 'outline' : 'primary'}
        className="min-h-11"
        disabled={busyId !== null}
        onClick={() => void toggle(item, !published)}
      >
        {busyId === item.id ? '…' : published ? t('unpublish') : t('publish')}
      </Button>
    );
  };
  const badge = (item: (typeof items)[number]) => (
    <Badge tone={visibility(item) ? 'positive' : 'muted'}>{visibility(item) ? t('status.published') : t('status.unpublished')}</Badge>
  );

  return (
    <div className="space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row">
        <Input
          type="search"
          aria-label={t('search')}
          placeholder={t('search')}
          value={searchInput}
          onChange={(event) => setSearchInput(event.target.value)}
          className="sm:max-w-sm"
        />
        <Select
          aria-label={t('statusFilter')}
          value={status}
          onChange={(event) => {
            setStatus(event.target.value as PublicationStatusFilter);
            setPage(1);
          }}
          className="sm:w-48"
        >
          {(['all', 'published', 'unpublished'] as const).map((value) => (
            <option key={value} value={value}>
              {t(`status.${value}` as 'status.all')}
            </option>
          ))}
        </Select>
      </div>
      {!canWrite ? <p className="text-xs text-muted">{t('readOnlyHint')}</p> : null}

      {state === 'loading' && !result ? (
        <LoadingState variant="table" rows={5} />
      ) : state === 'error' ? (
        <ErrorState message={common.t('loadError')} onRetry={load} retryLabel={common.t('retry')} />
      ) : items.length === 0 ? (
        <EmptyState
          icon={PackageOpen}
          title={filtered ? t('emptyFilteredTitle') : t('emptyTitle')}
          description={filtered ? t('emptyFilteredBody') : t('emptyBody')}
          action={
            filtered ? undefined : (
              <Button asChild variant="outline">
                <Link href="/products">{t('openProducts')}</Link>
              </Button>
            )
          }
        />
      ) : (
        <div className="rounded border border-border bg-surface" aria-busy={state === 'loading'}>
          <div className="hidden md:block">
            <Table>
              <THead>
                <TR>
                  <TH scope="col" className="px-3 py-2 text-start font-medium">{t('colProduct')}</TH>
                  <TH scope="col" className="px-3 py-2 text-start font-medium">{t('colVisibility')}</TH>
                  <TH scope="col" className="px-3 py-2 text-end font-medium">{t('colActions')}</TH>
                </TR>
              </THead>
              <TBody>
                {items.map((item) => (
                  <TR key={item.id}>
                    <TD className="px-3 py-2">
                      <div className="font-medium text-text"><bdi>{item.name}</bdi></div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                        {item.sku ? <span className="num">{item.sku}</span> : null}
                        {!item.isActive ? <Badge tone="muted">{t('inactiveProduct')}</Badge> : null}
                      </div>
                    </TD>
                    <TD className="px-3 py-2">{badge(item)}</TD>
                    <TD className="px-3 py-2 text-end">{action(item)}</TD>
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>
          <ul className="divide-y divide-border md:hidden">
            {items.map((item) => (
              <li key={item.id}>
                <MobileRecordItem
                  record={{
                    title: item.name,
                    subtitle: item.sku ?? undefined,
                    status: (
                      <>
                        {badge(item)}
                        {!item.isActive ? <Badge tone="muted">{t('inactiveProduct')}</Badge> : null}
                      </>
                    ),
                    actions: action(item),
                  }}
                />
              </li>
            ))}
          </ul>
          <Pagination
            className="border-t border-border p-3"
            page={result?.meta.currentPage ?? 1}
            lastPage={result?.meta.lastPage ?? 1}
            perPage={perPage}
            total={result?.meta.total}
            perPageOptions={PER_PAGE_OPTIONS}
            onPageChange={setPage}
            onPerPageChange={(value) => {
              setPerPage(value);
              setPage(1);
            }}
            disabled={state === 'loading'}
          />
        </div>
      )}
    </div>
  );
}
