'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale } from 'next-intl';
import { PackageOpen } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { useToast } from '@/components/ui/toast';
import { EmptyState, ErrorState, LoadingState, MobileRecordItem, PageHeader, Pagination } from '@/components/nebrax';
import { currentUser } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { commerceWorkspaceMessage } from '@/modules/commerce-workspace/messages';
import { useCommerceStoreContext } from '@/modules/commerce-workspace/store-context';
import {
  loadProductPublicationList,
  replaceProductPublication,
  type ProductPublicationListItem,
  type ProductPublicationListPage,
  type PublicationStatusFilter,
} from '@/modules/products/publication';

/**
 * COM-CATALOG-1 — Product Publication Workspace.
 *
 * Replaces the placeholder with the real publication workspace. Publication
 * state is read from CommerceListing.is_published only (the same gate the
 * public storefront reads); publish/unpublish goes through COM-WS-3's replace
 * contract with storefront ids that remain mere *choices* inside the
 * tenant-authorized set — the server is the sole authority on tenancy.
 *
 * Built as the first tab of the future store catalog: the workspace section
 * (products today, categories in COM-CATALOG-2) is isolated from the page
 * shell so adding «المنتجات | التصنيفات» later is additive, not a rewrite.
 */
export default function CommercePublishedProductsPage() {
  const locale = useLocale();
  const t = (key: Parameters<typeof commerceWorkspaceMessage>[1]) => commerceWorkspaceMessage(locale, key);
  const { catalog } = useCommerceStoreContext();
  const { error: showErrorToast, success: showSuccessToast } = useToast();

  const user = currentUser();
  const canManage = hasPermission(user?.permissions, user?.role, 'products.manage');

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [status, setStatus] = useState<PublicationStatusFilter>('all');
  const [storefrontId, setStorefrontId] = useState('');
  const [page, setPage] = useState(1);
  const [perPage, setPerPage] = useState(25);

  const [state, setState] = useState<'loading' | 'ready' | 'empty' | 'error'>('loading');
  const [result, setResult] = useState<ProductPublicationListPage | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const requestSeq = useRef(0);

  // متاجر متعددة → الاختيار مفيد؛ متجر واحد → لا ضجيج بلا قرار.
  const storefrontOptions = useMemo(
    () => (catalog.status === 'ready' ? catalog.stores.filter((store) => store.isActive) : []),
    [catalog],
  );
  const showStorefrontFilter = storefrontOptions.length > 1;

  useEffect(() => {
    const timer = setTimeout(() => {
      setDebouncedSearch(search);
      setPage(1);
    }, 300);
    return () => clearTimeout(timer);
  }, [search]);

  const load = useCallback(async () => {
    const seq = ++requestSeq.current;
    setState('loading');
    try {
      const next = await loadProductPublicationList({
        search: debouncedSearch,
        status,
        storefrontId: showStorefrontFilter && storefrontId ? storefrontId : undefined,
        page,
        perPage,
      });
      if (seq !== requestSeq.current) return; // ردّ متأخر لطلب أقدم — يُتجاهل
      setResult(next);
      setState(next.items.length === 0 ? 'empty' : 'ready');
    } catch {
      if (seq !== requestSeq.current) return;
      setResult(null);
      setState('error');
    }
  }, [debouncedSearch, status, storefrontId, showStorefrontFilter, page, perPage]);

  useEffect(() => {
    void load();
  }, [load]);

  /** نشر/إلغاء نشر عبر عقد COM-WS-3 نفسه — CommerceListing.is_published فقط. */
  const togglePublication = async (item: ProductPublicationListItem, storeId: string, publish: boolean) => {
    const key = `${item.id}:${storeId}`;
    if (busyKey) return;
    setBusyKey(key);
    try {
      const currentIds = item.stores.filter((store) => store.isPublished).map((store) => store.id);
      const nextIds = publish ? [...new Set([...currentIds, storeId])] : currentIds.filter((id) => id !== storeId);
      const stores = await replaceProductPublication(item.id, nextIds);
      setResult((prev) =>
        prev === null
          ? prev
          : {
              ...prev,
              items: prev.items.map((entry) =>
                entry.id === item.id
                  ? { ...entry, stores, isPublished: stores.some((store) => store.isPublished) }
                  : entry,
              ),
            },
      );
      showSuccessToast(publish ? t('publicationPublishSuccess') : t('publicationUnpublishSuccess'));
    } catch {
      showErrorToast(publish ? t('publicationPublishFailed') : t('publicationUnpublishFailed'));
    } finally {
      setBusyKey(null);
    }
  };

  const storeBadges = (item: ProductPublicationListItem) => (
    <div className="flex flex-wrap items-center gap-1.5">
      {item.stores.map((store) => (
        <Badge key={store.id} tone={store.isPublished ? 'positive' : 'muted'}>
          {store.name} · {store.isPublished ? t('publicationStatusPublished') : t('publicationStatusUnpublished')}
        </Badge>
      ))}
      {item.stores.length === 0 ? <span className="text-xs text-muted">{t('publicationNoWebStores')}</span> : null}
    </div>
  );

  const rowActions = (item: ProductPublicationListItem) => (
    <div className="flex flex-wrap items-center gap-1.5">
      {item.stores.map((store) => {
        const busy = busyKey === `${item.id}:${store.id}`;
        return (
          <Button
            key={store.id}
            type="button"
            variant="outline"
            size="sm"
            disabled={busyKey !== null}
            onClick={() => void togglePublication(item, store.id, !store.isPublished)}
          >
            {busy
              ? store.isPublished
                ? t('publicationUnpublishing')
                : t('publicationPublishing')
              : store.isPublished
                ? t('publicationUnpublishAction')
                : t('publicationPublishAction')}
            {' · '}
            {store.name}
          </Button>
        );
      })}
    </div>
  );

  const hasQuery = debouncedSearch.trim() !== '' || status !== 'all' || storefrontId !== '';

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={t('title')}
        title={t('publishedProducts')}
        description={t('publicationDescription')}
      />

      {/* شريط الاستعلام: بحث + حالة النشر + المتجر (حين يتعدد). يبقى صالحاً
          كشريطٍ مشترك حين تُضاف تبويبة «التصنيفات» في COM-CATALOG-2. */}
      <section className="flex flex-col gap-3 rounded border border-border bg-surface p-3 sm:flex-row sm:flex-wrap sm:items-end">
        <div className="min-w-0 flex-1">
          <label htmlFor="publication-search" className="mb-1 block text-xs font-medium text-muted">
            {t('publicationSearchLabel')}
          </label>
          <Input
            id="publication-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder={t('publicationSearchPlaceholder')}
            className="h-10 bg-surface"
          />
        </div>
        <div>
          <label htmlFor="publication-status" className="mb-1 block text-xs font-medium text-muted">
            {t('publicationFilterStatus')}
          </label>
          <Select
            id="publication-status"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as PublicationStatusFilter);
              setPage(1);
            }}
            className="h-10 bg-surface"
          >
            <option value="all">{t('publicationStatusAll')}</option>
            <option value="published">{t('publicationStatusPublished')}</option>
            <option value="unpublished">{t('publicationStatusUnpublished')}</option>
          </Select>
        </div>
        {showStorefrontFilter ? (
          <div>
            <label htmlFor="publication-storefront" className="mb-1 block text-xs font-medium text-muted">
              {t('publicationFilterStore')}
            </label>
            <Select
              id="publication-storefront"
              value={storefrontId}
              onChange={(event) => {
                setStorefrontId(event.target.value);
                setPage(1);
              }}
              className="h-10 bg-surface"
            >
              <option value="">{t('publicationAllStores')}</option>
              {storefrontOptions.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
      </section>

      {state === 'loading' ? <LoadingState variant="table" rows={6} label={t('publicationLoading')} /> : null}

      {state === 'error' ? <ErrorState message={t('publicationLoadFailed')} onRetry={() => void load()} /> : null}

      {state === 'empty' ? (
        <EmptyState
          icon={PackageOpen}
          title={hasQuery ? t('publicationEmptySearchTitle') : t('publicationEmptyTitle')}
          description={hasQuery ? t('publicationEmptySearchDescription') : t('publicationEmptyDescription')}
        />
      ) : null}

      {state === 'ready' && result ? (
        <>
          {/* Desktop: الجدول هو البطل. */}
          <div className="hidden md:block">
            <Table>
              <THead>
                <TR>
                  <TH>{t('publicationColumnProduct')}</TH>
                  <TH>{t('publicationColumnStores')}</TH>
                  {canManage ? <TH>{t('publicationColumnActions')}</TH> : null}
                </TR>
              </THead>
              <TBody>
                {result.items.map((item) => (
                  <TR key={item.id}>
                    <TD>
                      <div className="font-medium text-text">{item.name}</div>
                      <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
                        {item.sku ? <span className="num">{item.sku}</span> : null}
                        {!item.isActive ? <Badge tone="muted">{t('publicationInactiveProduct')}</Badge> : null}
                      </div>
                    </TD>
                    <TD>{storeBadges(item)}</TD>
                    {canManage ? <TD>{rowActions(item)}</TD> : null}
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>

          {/* Mobile: سجلات لمسية بلا خسارة معلومات — الحالة لكل متجر والإجراءات كاملة. */}
          <div className="divide-y divide-border rounded border border-border bg-surface md:hidden">
            {result.items.map((item) => (
              <MobileRecordItem
                key={item.id}
                record={{
                  title: item.name,
                  subtitle: item.sku,
                  status: storeBadges(item),
                  actions: canManage ? rowActions(item) : undefined,
                }}
              />
            ))}
          </div>

          <Pagination
            page={result.meta.currentPage}
            lastPage={result.meta.lastPage}
            perPage={result.meta.perPage}
            total={result.meta.total}
            onPageChange={setPage}
            onPerPageChange={(next) => {
              setPerPage(next);
              setPage(1);
            }}
            disabled={busyKey !== null}
          />
        </>
      ) : null}
    </div>
  );
}
