'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useLocale } from 'next-intl';
import type { ColumnDef } from '@tanstack/react-table';
import { ClipboardList } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { EmptyState, Pagination } from '@/components/nebrax';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Select } from '@/components/ui/select';
import { formatDateTime } from '@/lib/formatting';
import { ACTIVE_STORE_QUERY_PARAM, withStoreParam } from '@/modules/commerce-workspace/active-store';
import { useOptionalCommerceStoreContext } from '@/modules/commerce-workspace/store-context';
import {
  DELIVERY_METHODS,
  ORDERS_PER_PAGE_OPTIONS,
  ORDERS_Q_MIN,
  ORDERS_SORT_COLUMNS,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  buildOrdersQuery,
  classifyOrdersError,
  lifecycleOf,
  parseOrdersState,
  serializeOrdersState,
  type OrderSummary,
  type OrdersListState,
  type OrdersMeta,
} from './contract';
import { ordersMessages } from './messages';
import { OrderStatusBadge, PaymentStatusBadge, formatOrderMoney } from './order-display';
import { fetchOrders } from './orders-api';

/** يحفظ استعلام القائمة لهذا التبويب فتعود صفحة التفاصيل إلى الصفحة/التصفية نفسها. */
export const ORDERS_LIST_QUERY_KEY = 'awj-commerce-orders-list-query';

function rememberListQuery(query: string): void {
  try {
    window.sessionStorage.setItem(ORDERS_LIST_QUERY_KEY, query);
  } catch {
    // أفضل جهد.
  }
}

const EMPTY_META: OrdersMeta = { current_page: 1, per_page: 20, total: 0, last_page: 1 };

export function OrdersList() {
  const locale = useLocale();
  const { t, label } = ordersMessages(locale);
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const storeContext = useOptionalCommerceStoreContext();

  const state = useMemo(() => parseOrdersState(new URLSearchParams(searchParams.toString())), [searchParams]);
  const stores = storeContext?.catalog.status === 'ready' ? storeContext.catalog.stores : [];
  // المتجر المحسوم فقط يصير مرشِّحاً؛ غير المحسوم (اختيار مطلوب/لا متاجر) = كل المتاجر. `storefront_id` لا يُشتقّ من القناة.
  const activeStoreId = storeContext?.selectedStoreId ?? null;
  const storefrontId = state.scopeAll ? null : activeStoreId;

  const [rows, setRows] = useState<OrderSummary[]>([]);
  const [meta, setMeta] = useState<OrdersMeta>(EMPTY_META);
  const [loading, setLoading] = useState(true);
  const [errorKind, setErrorKind] = useState<ReturnType<typeof classifyOrdersError> | null>(null);
  const [searchInput, setSearchInput] = useState(state.q);
  const requestId = useRef(0);

  /**
   * يكتب الحالة في الرابط. `store` في الرابط يجب أن يطابق دائماً المتجر المعروض:
   *  - `storeId` صريح (اختيار المستخدم الآن) يتقدّم، لأن السياق لا يُحدَّث إلا بعد هذه الدورة؛
   *  - وإلا المتجر المحسوم من السياق (لا نسخة قديمة من `searchParams`)؛
   *  - وإلا (متجر غير محسوم/طلب غير صالح) يُترك ما في الرابط كما هو فلا يُمحى ولا يُخترع.
   */
  const update = useCallback(
    (patch: Partial<OrdersListState>, options: { resetPage?: boolean; storeId?: string } = {}) => {
      const resetPage = options.resetPage ?? true;
      const next: OrdersListState = { ...state, ...patch, page: resetPage ? 1 : (patch.page ?? state.page) };
      const params = serializeOrdersState(next);
      const store = options.storeId ?? activeStoreId ?? searchParams.get(ACTIVE_STORE_QUERY_PARAM);
      if (store) params.set(ACTIVE_STORE_QUERY_PARAM, store);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [activeStoreId, pathname, router, searchParams, state],
  );

  // بحث مؤجَّل 300ms؛ لا طلب بأقل من الحد الأدنى (يُحسم في buildOrdersQuery).
  useEffect(() => {
    if (searchInput === state.q) return;
    const timer = window.setTimeout(() => update({ q: searchInput }), 300);
    return () => window.clearTimeout(timer);
  }, [searchInput, state.q, update]);

  useEffect(() => setSearchInput(state.q), [state.q]);

  /**
   * تغيّر المتجر المحسوم من **أي** مصدر (محدِّد القائمة أو محدِّد الغلاف العلوي أو سياق آخر) يعيد الترقيم إلى 1.
   * وإلا طلبنا صفحة المتجر القديم من المتجر الجديد: قد يعيد الخادم قائمة فارغة (متجر بصفحة واحدة) و`Pagination` يقصّ
   * العرض إلى 1 ويعطّل الأزرار، فيبدو أن لا طلبات. الاستعلام يستعمل الصفحة 1 فوراً (لا طلب بصفحة قديمة أبداً)،
   * ثم يُصحَّح الرابط. الانتقال من «لا متجر محسوم» إلى متجر (اكتمال تحميل الكتالوج) ليس تغييراً: يحفظ الروابط العميقة والتحديث.
   */
  const [handledStore, setHandledStore] = useState<string | null>(storefrontId);
  const pendingReset = handledStore !== null && storefrontId !== null && handledStore !== storefrontId;
  const resetIssuedFor = useRef<string | null>(null);
  useEffect(() => {
    if (handledStore === storefrontId) return;
    if (!pendingReset) {
      setHandledStore(storefrontId);
      return;
    }
    if (state.page <= 1) {
      resetIssuedFor.current = null;
      setHandledStore(storefrontId);
      return;
    }
    // المزوّد يكتب `?store=` بـ`history.replaceState` في effect الأب (بعد effect الابن). تصحيحنا قبل ذلك كان يُمحى:
    // ننتظر حتى يطابق الرابط المتجر المحسوم، ثم نزيل الصفحة. الاستعلام يستعمل الصفحة 1 في الأثناء.
    if (searchParams.get(ACTIVE_STORE_QUERY_PARAM) !== storefrontId) return;
    if (resetIssuedFor.current !== storefrontId) {
      resetIssuedFor.current = storefrontId;
      update({}, { resetPage: true });
    }
  }, [handledStore, pendingReset, searchParams, state.page, storefrontId, update]);

  const query = useMemo(
    () => buildOrdersQuery(pendingReset ? { ...state, page: 1 } : state, storefrontId).toString(),
    [pendingReset, state, storefrontId],
  );

  const load = useCallback(() => {
    const id = ++requestId.current;
    setLoading(true);
    setErrorKind(null);
    fetchOrders(new URLSearchParams(query))
      .then((result) => {
        if (id !== requestId.current) return;
        setRows(result.data);
        setMeta(result.meta);
      })
      .catch((error) => {
        if (id !== requestId.current) return;
        setRows([]);
        setMeta(EMPTY_META);
        setErrorKind(classifyOrdersError(error));
      })
      .finally(() => {
        if (id === requestId.current) setLoading(false);
      });
  }, [query]);

  useEffect(() => load(), [load]);

  // يحفظ الاستعلام المرئي للعودة من التفاصيل.
  useEffect(() => {
    const params = serializeOrdersState(state);
    rememberListQuery(params.toString());
  }, [state]);

  const channels = useMemo(() => {
    const seen = new Map<string, string>();
    for (const store of stores) {
      if (store.salesChannelId && !seen.has(store.salesChannelId)) seen.set(store.salesChannelId, store.name);
    }
    return [...seen.entries()].map(([id, name]) => ({ id, name }));
  }, [stores]);

  const hasFilters = Boolean(
    state.q || state.salesChannelId || state.paymentStatus || state.paymentMethod || state.deliveryMethod || state.from || state.to,
  );

  const detailHref = useCallback((id: string) => withStoreParam(`/commerce/orders/${id}`, activeStoreId), [activeStoreId]);

  const storeLabel = (order: OrderSummary) => order.channel.storefront_name ?? order.channel.sales_channel_name ?? '—';
  const methodLabel = (order: OrderSummary) =>
    order.payment.payment_method_name ?? (order.payment.method ? label('method', order.payment.method) : '—');

  const columns = useMemo<ColumnDef<OrderSummary, unknown>[]>(
    () => [
      {
        accessorKey: 'number',
        header: t('number'),
        cell: ({ row }) => (
          <Link href={detailHref(row.original.id)} className="num text-primary hover:underline">
            {row.original.number}
          </Link>
        ),
      },
      {
        accessorKey: 'created_at',
        header: t('date'),
        cell: ({ row }) => <span className="num text-muted">{formatDateTime(row.original.created_at, locale)}</span>,
      },
      {
        id: 'customer',
        header: t('customer'),
        enableSorting: false,
        accessorFn: (o) => o.customer.name ?? '',
        cell: ({ row }) => (
          <div className="min-w-0">
            <bdi className="block truncate">{row.original.customer.name ?? '—'}</bdi>
            {row.original.customer.phone ? <span className="num block text-xs text-muted" dir="ltr">{row.original.customer.phone}</span> : null}
          </div>
        ),
      },
      {
        id: 'store',
        header: t('store'),
        enableSorting: false,
        accessorFn: storeLabel,
        cell: ({ row }) => <bdi>{storeLabel(row.original)}</bdi>,
      },
      {
        id: 'payment_method',
        header: t('paymentMethod'),
        enableSorting: false,
        accessorFn: methodLabel,
        cell: ({ row }) => <span>{methodLabel(row.original)}</span>,
      },
      {
        id: 'payment_status',
        header: t('paymentStatus'),
        enableSorting: false,
        accessorFn: (o) => o.payment.status ?? '',
        cell: ({ row }) => <PaymentStatusBadge status={row.original.payment.status} locale={locale} />,
      },
      {
        id: 'status',
        header: t('orderStatus'),
        enableSorting: false,
        accessorFn: (o) => lifecycleOf(o),
        cell: ({ row }) => <OrderStatusBadge status={lifecycleOf(row.original)} locale={locale} />,
      },
      {
        accessorKey: 'total',
        header: t('total'),
        cell: ({ row }) => <div className="num text-end">{formatOrderMoney(row.original.total)}</div>,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [detailHref, locale],
  );

  const sortValue = state.sort;
  const errorMessage =
    errorKind === null
      ? null
      : errorKind === 'forbidden'
        ? `${t('forbidden')} ${t('restrictedHint')} ${t('capabilityHint')}`
        : errorKind === 'network'
          ? t('networkError')
          : errorKind === 'validation'
            ? t('validationError')
            : t('loadError');

  return (
    <div className="space-y-4">
      <section aria-label={t('filtersLabel')} className="rounded border border-border bg-surface p-3">
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={t('search')} className="sm:col-span-2">
            <Input
              type="search"
              value={searchInput}
              maxLength={100}
              placeholder={t('searchPlaceholder')}
              aria-label={t('search')}
              onChange={(event) => setSearchInput(event.target.value)}
            />
            {searchInput.trim().length > 0 && searchInput.trim().length < ORDERS_Q_MIN ? (
              <span className="mt-1 block text-xs text-muted">{t('searchMinHint')}</span>
            ) : null}
          </Field>
          <Field label={t('store')}>
            <Select
              value={state.scopeAll || !activeStoreId ? '' : activeStoreId}
              aria-label={t('store')}
              onChange={(event) => {
                const id = event.target.value;
                if (id === '') {
                  update({ scopeAll: true });
                } else {
                  storeContext?.setSelectedStoreId(id);
                  // الرابط يحمل المتجر الجديد صراحةً — لا يُعاد كتابة المتجر السابق فوق مزامنة المزوّد.
                  update({ scopeAll: false }, { storeId: id });
                }
              }}
            >
              <option value="">{t('allStores')}</option>
              {stores.map((store) => (
                <option key={store.id} value={store.id}>
                  {store.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('channel')}>
            <Select value={state.salesChannelId} aria-label={t('channel')} onChange={(event) => update({ salesChannelId: event.target.value })}>
              <option value="">{t('allChannels')}</option>
              {channels.map((channel) => (
                <option key={channel.id} value={channel.id}>
                  {channel.name}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('paymentStatus')}>
            <Select value={state.paymentStatus} aria-label={t('paymentStatus')} onChange={(event) => update({ paymentStatus: event.target.value })}>
              <option value="">{t('allPaymentStatuses')}</option>
              {PAYMENT_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {label('payment', value)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('paymentMethod')}>
            <Select value={state.paymentMethod} aria-label={t('paymentMethod')} onChange={(event) => update({ paymentMethod: event.target.value })}>
              <option value="">{t('allPaymentMethods')}</option>
              {PAYMENT_METHODS.map((value) => (
                <option key={value} value={value}>
                  {label('method', value)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('deliveryMethod')}>
            <Select value={state.deliveryMethod} aria-label={t('deliveryMethod')} onChange={(event) => update({ deliveryMethod: event.target.value })}>
              <option value="">{t('allDeliveryMethods')}</option>
              {DELIVERY_METHODS.map((value) => (
                <option key={value} value={value}>
                  {label('delivery', value)}
                </option>
              ))}
            </Select>
          </Field>
          <Field label={t('dateFrom')}>
            <Input type="date" value={state.from} max={state.to || undefined} aria-label={t('dateFrom')} onChange={(event) => update({ from: event.target.value })} />
          </Field>
          <Field label={t('dateTo')}>
            <Input type="date" value={state.to} min={state.from || undefined} aria-label={t('dateTo')} onChange={(event) => update({ to: event.target.value })} />
          </Field>
          <Field label={t('sortLabel')}>
            <Select value={sortValue} aria-label={t('sortLabel')} onChange={(event) => update({ sort: event.target.value })}>
              <option value="-created_at">{t('sortNewest')}</option>
              <option value="created_at">{t('sortOldest')}</option>
              <option value="-total">{t('sortTotalDesc')}</option>
              <option value="total">{t('sortTotalAsc')}</option>
            </Select>
          </Field>
          {hasFilters ? (
            <div className="flex items-end">
              <Button type="button" variant="ghost" onClick={() => { setSearchInput(''); update({ q: '', salesChannelId: '', paymentStatus: '', paymentMethod: '', deliveryMethod: '', from: '', to: '' }); }}>
                {t('clearFilters')}
              </Button>
            </div>
          ) : null}
        </div>
      </section>

      {errorKind === 'forbidden' ? (
        <EmptyState icon={ClipboardList} title={t('forbidden')} description={`${t('restrictedHint')} ${t('capabilityHint')}`} />
      ) : (
        <>
          <DataTable<OrderSummary>
            columns={columns}
            data={rows}
            loading={loading}
            showToolbar={false}
            error={errorMessage}
            onRetry={load}
            retryLabel={t('retry')}
            emptyLabel={hasFilters ? t('emptyFilteredTitle') : t('emptyTitle')}
            emptyDescription={hasFilters ? t('emptyFilteredDescription') : t('emptyDescription')}
            serverSort={{
              value: sortValue,
              columns: [...ORDERS_SORT_COLUMNS],
              onChange: (value) => update({ sort: value }),
            }}
            mobileRecord={(order) => ({
              title: <Link href={detailHref(order.id)} className="num text-primary hover:underline">{order.number}</Link>,
              subtitle: order.customer.name ?? '—',
              caption: `${storeLabel(order)} · ${methodLabel(order)}`,
              amount: formatOrderMoney(order.total),
              amountLabel: t('total'),
              status: (
                <span className="flex flex-wrap items-center gap-1.5">
                  <OrderStatusBadge status={lifecycleOf(order)} locale={locale} />
                  <PaymentStatusBadge status={order.payment.status} locale={locale} />
                </span>
              ),
              meta: formatDateTime(order.created_at, locale),
            })}
          />
          {!loading && meta.total > 0 ? (
            <Pagination
              page={meta.current_page}
              lastPage={meta.last_page}
              perPage={meta.per_page}
              total={meta.total}
              perPageOptions={ORDERS_PER_PAGE_OPTIONS}
              onPageChange={(page) => update({ page }, { resetPage: false })}
              onPerPageChange={(perPage) => update({ perPage })}
              disabled={loading}
            />
          ) : null}
        </>
      )}
    </div>
  );
}

function Field({ label, className, children }: { label: string; className?: string; children: React.ReactNode }) {
  return (
    <div className={className}>
      <span className="mb-1 block text-xs font-medium text-muted">{label}</span>
      {children}
    </div>
  );
}
