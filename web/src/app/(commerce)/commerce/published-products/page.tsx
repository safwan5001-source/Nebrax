'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useLocale } from 'next-intl';
import { PackageOpen } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { Tabs } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { EmptyState, ErrorState, LoadingState, MobileRecordItem, PageHeader, Pagination } from '@/components/nebrax';
import { currentUser } from '@/lib/auth';
import { hasPermission } from '@/lib/permissions';
import { commerceWorkspaceMessage } from '@/modules/commerce-workspace/messages';
import { useCommerceStoreContext } from '@/modules/commerce-workspace/store-context';
import {
  loadCategoryPublicationList,
  replaceCategoryPublication,
  type CategoryPublicationListItem,
  type CategoryPublicationListPage,
} from '@/modules/categories/publication';
import {
  loadProductPublicationList,
  replaceProductPublication,
  type ProductPublicationListItem,
  type ProductPublicationListPage,
  type PublicationStatusFilter,
} from '@/modules/products/publication';

type WorkspaceTab = 'products' | 'categories';
type MessageKey = Parameters<typeof commerceWorkspaceMessage>[1];
type StorefrontOption = { id: string; name: string; isActive: boolean };

/**
 * COM-CATALOG-1 + COM-CATALOG-2 — Store Catalog Publication Workspace.
 *
 * «المنتجات | التصنيفات»: two fully independent publication gates.
 * Product publication reads CommerceListing.is_published; category
 * publication reads CommerceCategoryListing.is_published — neither tab ever
 * touches the other's source of truth. In both, storefront ids remain mere
 * *choices* inside the tenant-authorized set — the server is the sole
 * authority on tenancy.
 */
export default function CommercePublishedProductsPage() {
  const locale = useLocale();
  const t = (key: MessageKey) => commerceWorkspaceMessage(locale, key);
  const { catalog } = useCommerceStoreContext();

  const [tab, setTab] = useState<WorkspaceTab>('products');

  // متاجر متعددة → الاختيار مفيد؛ متجر واحد → لا ضجيج بلا قرار.
  const storefrontOptions: StorefrontOption[] = useMemo(
    () => (catalog.status === 'ready' ? catalog.stores.filter((store) => store.isActive) : []),
    [catalog],
  );
  const showStorefrontFilter = storefrontOptions.length > 1;

  return (
    <div className="space-y-5">
      <PageHeader
        eyebrow={t('title')}
        title={t('publishedProducts')}
        description={t('publicationDescription')}
      />

      <Tabs
        tabs={[
          { id: 'products', label: t('publicationTabProducts') },
          { id: 'categories', label: t('publicationTabCategories') },
        ]}
        value={tab}
        onChange={(id) => setTab(id as WorkspaceTab)}
      />

      {tab === 'products' ? (
        <ProductsPublicationSection
          t={t}
          storefrontOptions={storefrontOptions}
          showStorefrontFilter={showStorefrontFilter}
        />
      ) : (
        <CategoriesPublicationSection
          t={t}
          storefrontOptions={storefrontOptions}
          showStorefrontFilter={showStorefrontFilter}
        />
      )}
    </div>
  );
}

/** شريط الاستعلام المشترك: بحث + حالة النشر + المتجر (حين يتعدد). */
function PublicationQueryBar({
  t,
  searchLabel,
  searchPlaceholder,
  search,
  onSearchChange,
  status,
  onStatusChange,
  storefrontId,
  onStorefrontChange,
  storefrontOptions,
  showStorefrontFilter,
  idPrefix,
}: {
  t: (key: MessageKey) => string;
  searchLabel: string;
  searchPlaceholder: string;
  search: string;
  onSearchChange: (value: string) => void;
  status: PublicationStatusFilter;
  onStatusChange: (value: PublicationStatusFilter) => void;
  storefrontId: string;
  onStorefrontChange: (value: string) => void;
  storefrontOptions: StorefrontOption[];
  showStorefrontFilter: boolean;
  idPrefix: string;
}) {
  return (
    <section className="flex flex-col gap-3 rounded border border-border bg-surface p-3 sm:flex-row sm:flex-wrap sm:items-end">
      <div className="min-w-0 flex-1">
        <label htmlFor={`${idPrefix}-search`} className="mb-1 block text-xs font-medium text-muted">
          {searchLabel}
        </label>
        <Input
          id={`${idPrefix}-search`}
          type="search"
          value={search}
          onChange={(event) => onSearchChange(event.target.value)}
          placeholder={searchPlaceholder}
          className="h-10 bg-surface"
        />
      </div>
      <div>
        <label htmlFor={`${idPrefix}-status`} className="mb-1 block text-xs font-medium text-muted">
          {t('publicationFilterStatus')}
        </label>
        <Select
          id={`${idPrefix}-status`}
          value={status}
          onChange={(event) => onStatusChange(event.target.value as PublicationStatusFilter)}
          className="h-10 bg-surface"
        >
          <option value="all">{t('publicationStatusAll')}</option>
          <option value="published">{t('publicationStatusPublished')}</option>
          <option value="unpublished">{t('publicationStatusUnpublished')}</option>
        </Select>
      </div>
      {showStorefrontFilter ? (
        <div>
          <label htmlFor={`${idPrefix}-storefront`} className="mb-1 block text-xs font-medium text-muted">
            {t('publicationFilterStore')}
          </label>
          <Select
            id={`${idPrefix}-storefront`}
            value={storefrontId}
            onChange={(event) => onStorefrontChange(event.target.value)}
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
  );
}

type PublicationListItem = ProductPublicationListItem | CategoryPublicationListItem;
type PublicationListPage = ProductPublicationListPage | CategoryPublicationListPage;

/**
 * قسم نشر مشترك البنية (جدول سطح مكتب + سجلات لمسية + ترقيم + حالات) — تمرّر
 * له كل تبويبة دوال التحميل/الاستبدال ومفاتيح الرسائل الخاصة بها فقط؛ منطق
 * الحالة والاستعلامات متطابق بين المنتجات والتصنيفات.
 */
function PublicationSection<T extends PublicationListItem>({
  t,
  storefrontOptions,
  showStorefrontFilter,
  idPrefix,
  searchLabel,
  searchPlaceholder,
  loadingLabel,
  loadFailedLabel,
  emptyTitle,
  emptyDescription,
  emptySearchTitle,
  emptySearchDescription,
  columnSubject,
  renderSubject,
  publishSuccess,
  publishFailed,
  unpublishSuccess,
  unpublishFailed,
  loadList,
  replacePublication,
}: {
  t: (key: MessageKey) => string;
  storefrontOptions: StorefrontOption[];
  showStorefrontFilter: boolean;
  idPrefix: string;
  searchLabel: string;
  searchPlaceholder: string;
  loadingLabel: string;
  loadFailedLabel: string;
  emptyTitle: string;
  emptyDescription: string;
  emptySearchTitle: string;
  emptySearchDescription: string;
  columnSubject: string;
  renderSubject: (item: T) => React.ReactNode;
  publishSuccess: string;
  publishFailed: string;
  unpublishSuccess: string;
  unpublishFailed: string;
  loadList: (params: {
    search?: string;
    status?: PublicationStatusFilter;
    storefrontId?: string;
    page?: number;
    perPage?: number;
  }) => Promise<PublicationListPage>;
  replacePublication: (id: string, storefrontIds: string[]) => Promise<T['stores']>;
}) {
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
  const [result, setResult] = useState<PublicationListPage | null>(null);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const requestSeq = useRef(0);

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
      const next = await loadList({
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
  }, [loadList, debouncedSearch, status, storefrontId, showStorefrontFilter, page, perPage]);

  useEffect(() => {
    void load();
  }, [load]);

  /** نشر/إلغاء نشر عبر عقد الاستبدال نفسه — مصدر الحقيقة يبقى خادمياً دائماً. */
  const togglePublication = async (item: T, storeId: string, publish: boolean) => {
    const key = `${item.id}:${storeId}`;
    if (busyKey) return;
    setBusyKey(key);
    try {
      const currentIds = item.stores.filter((store) => store.isPublished).map((store) => store.id);
      const nextIds = publish ? [...new Set([...currentIds, storeId])] : currentIds.filter((id) => id !== storeId);
      const stores = await replacePublication(item.id, nextIds);
      setResult((prev) =>
        prev === null
          ? prev
          : ({
              ...prev,
              items: (prev.items as T[]).map((entry) =>
                entry.id === item.id
                  ? { ...entry, stores, isPublished: stores.some((store) => store.isPublished) }
                  : entry,
              ),
            } as PublicationListPage),
      );
      showSuccessToast(publish ? publishSuccess : unpublishSuccess);
    } catch {
      showErrorToast(publish ? publishFailed : unpublishFailed);
    } finally {
      setBusyKey(null);
    }
  };

  const storeBadges = (item: T) => (
    <div className="flex flex-wrap items-center gap-1.5">
      {item.stores.map((store) => (
        <Badge key={store.id} tone={store.isPublished ? 'positive' : 'muted'}>
          {store.name} · {store.isPublished ? t('publicationStatusPublished') : t('publicationStatusUnpublished')}
        </Badge>
      ))}
      {item.stores.length === 0 ? <span className="text-xs text-muted">{t('publicationNoWebStores')}</span> : null}
    </div>
  );

  const rowActions = (item: T) => (
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
    <>
      <PublicationQueryBar
        t={t}
        searchLabel={searchLabel}
        searchPlaceholder={searchPlaceholder}
        search={search}
        onSearchChange={setSearch}
        status={status}
        onStatusChange={(value) => {
          setStatus(value);
          setPage(1);
        }}
        storefrontId={storefrontId}
        onStorefrontChange={(value) => {
          setStorefrontId(value);
          setPage(1);
        }}
        storefrontOptions={storefrontOptions}
        showStorefrontFilter={showStorefrontFilter}
        idPrefix={idPrefix}
      />

      {state === 'loading' ? <LoadingState variant="table" rows={6} label={loadingLabel} /> : null}

      {state === 'error' ? <ErrorState message={loadFailedLabel} onRetry={() => void load()} /> : null}

      {state === 'empty' ? (
        <EmptyState
          icon={PackageOpen}
          title={hasQuery ? emptySearchTitle : emptyTitle}
          description={hasQuery ? emptySearchDescription : emptyDescription}
        />
      ) : null}

      {state === 'ready' && result ? (
        <>
          {/* Desktop: الجدول هو البطل. */}
          <div className="hidden md:block">
            <Table>
              <THead>
                <TR>
                  <TH>{columnSubject}</TH>
                  <TH>{t('publicationColumnStores')}</TH>
                  {canManage ? <TH>{t('publicationColumnActions')}</TH> : null}
                </TR>
              </THead>
              <TBody>
                {(result.items as T[]).map((item) => (
                  <TR key={item.id}>
                    <TD>{renderSubject(item)}</TD>
                    <TD>{storeBadges(item)}</TD>
                    {canManage ? <TD>{rowActions(item)}</TD> : null}
                  </TR>
                ))}
              </TBody>
            </Table>
          </div>

          {/* Mobile: سجلات لمسية بلا خسارة معلومات — الحالة لكل متجر والإجراءات كاملة. */}
          <div className="divide-y divide-border rounded border border-border bg-surface md:hidden">
            {(result.items as T[]).map((item) => (
              <MobileRecordItem
                key={item.id}
                record={{
                  title: item.name,
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
    </>
  );
}

/** COM-CATALOG-1 — تبويبة «المنتجات»: السلوك الأصلي بلا أي تغيير دلالي. */
function ProductsPublicationSection({
  t,
  storefrontOptions,
  showStorefrontFilter,
}: {
  t: (key: MessageKey) => string;
  storefrontOptions: StorefrontOption[];
  showStorefrontFilter: boolean;
}) {
  return (
    <PublicationSection<ProductPublicationListItem>
      t={t}
      storefrontOptions={storefrontOptions}
      showStorefrontFilter={showStorefrontFilter}
      idPrefix="publication"
      searchLabel={t('publicationSearchLabel')}
      searchPlaceholder={t('publicationSearchPlaceholder')}
      loadingLabel={t('publicationLoading')}
      loadFailedLabel={t('publicationLoadFailed')}
      emptyTitle={t('publicationEmptyTitle')}
      emptyDescription={t('publicationEmptyDescription')}
      emptySearchTitle={t('publicationEmptySearchTitle')}
      emptySearchDescription={t('publicationEmptySearchDescription')}
      columnSubject={t('publicationColumnProduct')}
      publishSuccess={t('publicationPublishSuccess')}
      publishFailed={t('publicationPublishFailed')}
      unpublishSuccess={t('publicationUnpublishSuccess')}
      unpublishFailed={t('publicationUnpublishFailed')}
      loadList={loadProductPublicationList}
      replacePublication={replaceProductPublication}
      renderSubject={(item) => (
        <>
          <div className="font-medium text-text">{item.name}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
            {item.sku ? <span className="num">{item.sku}</span> : null}
            {!item.isActive ? <Badge tone="muted">{t('publicationInactiveProduct')}</Badge> : null}
          </div>
        </>
      )}
    />
  );
}

/** COM-CATALOG-2 — تبويبة «التصنيفات»: نشر مستقل تماماً عن نشر المنتجات. */
function CategoriesPublicationSection({
  t,
  storefrontOptions,
  showStorefrontFilter,
}: {
  t: (key: MessageKey) => string;
  storefrontOptions: StorefrontOption[];
  showStorefrontFilter: boolean;
}) {
  return (
    <PublicationSection<CategoryPublicationListItem>
      t={t}
      storefrontOptions={storefrontOptions}
      showStorefrontFilter={showStorefrontFilter}
      idPrefix="category-publication"
      searchLabel={t('categoryPublicationSearchLabel')}
      searchPlaceholder={t('categoryPublicationSearchPlaceholder')}
      loadingLabel={t('categoryPublicationLoading')}
      loadFailedLabel={t('categoryPublicationLoadFailed')}
      emptyTitle={t('categoryPublicationEmptyTitle')}
      emptyDescription={t('categoryPublicationEmptyDescription')}
      emptySearchTitle={t('categoryPublicationEmptySearchTitle')}
      emptySearchDescription={t('categoryPublicationEmptySearchDescription')}
      columnSubject={t('categoryPublicationColumnCategory')}
      publishSuccess={t('categoryPublicationPublishSuccess')}
      publishFailed={t('categoryPublicationPublishFailed')}
      unpublishSuccess={t('categoryPublicationUnpublishSuccess')}
      unpublishFailed={t('categoryPublicationUnpublishFailed')}
      loadList={loadCategoryPublicationList}
      replacePublication={replaceCategoryPublication}
      renderSubject={(item) => (
        <>
          <div className="font-medium text-text">{item.name}</div>
          <div className="mt-0.5 flex flex-wrap items-center gap-2 text-xs text-muted">
            {item.parentName ? (
              <span>
                {t('categoryPublicationParentPrefix')} {item.parentName}
              </span>
            ) : null}
            {!item.isActive ? <Badge tone="muted">{t('categoryPublicationInactive')}</Badge> : null}
          </div>
        </>
      )}
    />
  );
}
