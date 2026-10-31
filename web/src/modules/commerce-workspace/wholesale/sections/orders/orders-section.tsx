'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
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
import { ACTIVE_STORE_QUERY_PARAM } from '@/modules/commerce-workspace/active-store';
import {
  DELIVERY_METHODS,
  ORDERS_PER_PAGE_OPTIONS,
  ORDERS_Q_MIN,
  ORDERS_SORT_COLUMNS,
  PAYMENT_METHODS,
  PAYMENT_STATUSES,
  classifyOrdersError,
  lifecycleOf,
  serializeOrdersState,
  type OrderSummary,
  type OrdersListState,
  type OrdersMeta,
} from '@/modules/commerce-workspace/orders/contract';
import { ordersMessages } from '@/modules/commerce-workspace/orders/messages';
import { OrderStatusBadge, PaymentStatusBadge, formatOrderMoney } from '@/modules/commerce-workspace/orders/order-display';
import { fetchOrders } from '@/modules/commerce-workspace/orders/orders-api';
import { useWholesaleChannel } from '../../channel-context';
import { commonMessages } from '../../messages/common';
import { wholesaleOrdersMessages } from './messages';
import { OrderSheet } from './order-sheet';
import { buildWholesaleOrdersQuery, parseWholesaleOrdersState } from './query';

const EMPTY_META: OrdersMeta = { current_page: 1, per_page: 20, total: 0, last_page: 1 };

/** Wholesale Orders — the staff orders endpoint locked to the wholesale channel. Mounted only when readiness is `active`. */
export function OrdersSection() {
  const locale = useLocale();
  const orders = ordersMessages(locale);
  const { t: o } = orders;
  const { t } = wholesaleOrdersMessages.forLocale(locale);
  const common = commonMessages.forLocale(locale).t;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const { channelId, store } = useWholesaleChannel();

  const state = useMemo(() => parseWholesaleOrdersState(new URLSearchParams(searchParams.toString())), [searchParams]);
  const storeId = store?.id ?? null;

  const [rows, setRows] = useState<OrderSummary[]>([]);
  const [meta, setMeta] = useState<OrdersMeta>(EMPTY_META);
  const [loading, setLoading] = useState(true);
  const [errorKind, setErrorKind] = useState<ReturnType<typeof classifyOrdersError> | null>(null);
  const [searchInput, setSearchInput] = useState(state.q);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const update = useCallback(
    (patch: Partial<OrdersListState>, options: { resetPage?: boolean } = {}) => {
      const resetPage = options.resetPage ?? true;
      const next: OrdersListState = { ...state, ...patch, page: resetPage ? 1 : (patch.page ?? state.page) };
      const params = serializeOrdersState({ ...next, salesChannelId: '', scopeAll: false });
      const keepStore = storeId ?? searchParams.get(ACTIVE_STORE_QUERY_PARAM);
      if (keepStore) params.set(ACTIVE_STORE_QUERY_PARAM, keepStore);
      const qs = params.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams, state, storeId],
  );

  useEffect(() => {
    if (searchInput === state.q) return;
    const timer = window.setTimeout(() => update({ q: searchInput }), 300);
    return () => window.clearTimeout(timer);
  }, [searchInput, state.q, update]);
  useEffect(() => setSearchInput(state.q), [state.q]);

  const query = useMemo(() => (channelId ? buildWholesaleOrdersQuery(state, channelId).toString() : null), [channelId, state]);

  useEffect(() => {
    if (query === null) return;
    let live = true;
    setLoading(true);
    setErrorKind(null);
    fetchOrders(new URLSearchParams(query))
      .then((result) => {
        if (!live) return;
        setRows(result.data);
        setMeta(result.meta);
      })
      .catch((error) => {
        if (!live) return;
        setRows([]);
        setMeta(EMPTY_META);
        setErrorKind(classifyOrdersError(error));
      })
      .finally(() => {
        if (live) setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [query, reloadToken]);

  const hasFilters = Boolean(state.q || state.paymentStatus || state.paymentMethod || state.deliveryMethod || state.from || state.to);
  const methodLabel = (order: OrderSummary) => order.payment.payment_method_name ?? (order.payment.method ? orders.label('method', order.payment.method) : '—');

  const columns = useMemo<ColumnDef<OrderSummary, unknown>[]>(
    () => [
      {
        accessorKey: 'number',
        header: o('number'),
        cell: ({ row }) => (
          <button
            type="button"
            aria-label={t('openAria', { number: row.original.number })}
            className="num min-h-8 rounded text-primary hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"
            onClick={() => setSelectedId(row.original.id)}
          >
            {row.original.number}
          </button>
        ),
      },
      {
        accessorKey: 'created_at',
        header: o('date'),
        cell: ({ row }) => <span className="num text-muted">{formatDateTime(row.original.created_at, locale)}</span>,
      },
      {
        id: 'customer',
        header: t('buyer'),
        enableSorting: false,
        accessorFn: (order) => order.customer.name ?? '',
        cell: ({ row }) => (
          <div className="min-w-0">
            <bdi className="block truncate">{row.original.customer.name ?? '—'}</bdi>
            {row.original.customer.phone ? <span className="num block text-xs text-muted" dir="ltr">{row.original.customer.phone}</span> : null}
          </div>
        ),
      },
      {
        id: 'payment_method',
        header: o('paymentMethod'),
        enableSorting: false,
        accessorFn: methodLabel,
        cell: ({ row }) => <span>{methodLabel(row.original)}</span>,
      },
      {
        id: 'payment_status',
        header: o('paymentStatus'),
        enableSorting: false,
        accessorFn: (order) => order.payment.status ?? '',
        cell: ({ row }) => <PaymentStatusBadge status={row.original.payment.status} locale={locale} />,
      },
      {
        id: 'status',
        header: o('orderStatus'),
        enableSorting: false,
        accessorFn: (order) => lifecycleOf(order),
        cell: ({ row }) => <OrderStatusBadge status={lifecycleOf(row.original)} locale={locale} />,
      },
      {
        accessorKey: 'total',
        header: o('total'),
        cell: ({ row }) => <div className="num text-end">{formatOrderMoney(row.original.total)}</div>,
      },
    ],
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [locale],
  );

  const errorMessage =
    errorKind === null || errorKind === 'forbidden'
      ? null
      : errorKind === 'network'
        ? o('networkError')
        : errorKind === 'validation'
          ? o('validationError')
          : o('loadError');

  return (
    <div className="space-y-4">
      <p className="max-w-3xl text-sm leading-relaxed text-muted">{t('description')}</p>

      <section aria-label={t('filtersLabel')} className="rounded border border-border bg-surface p-3">
        <p className="mb-2 text-xs text-muted">{t('channelScope', { channel: store?.name ?? '—' })}</p>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Field label={o('search')} className="sm:col-span-2">
            <Input
              type="search"
              value={searchInput}
              maxLength={100}
              placeholder={o('searchPlaceholder')}
              aria-label={o('search')}
              onChange={(event) => setSearchInput(event.target.value)}
            />
            {searchInput.trim().length > 0 && searchInput.trim().length < ORDERS_Q_MIN ? (
              <span className="mt-1 block text-xs text-muted">{o('searchMinHint')}</span>
            ) : null}
          </Field>
          <Field label={o('paymentStatus')}>
            <Select value={state.paymentStatus} aria-label={o('paymentStatus')} onChange={(event) => update({ paymentStatus: event.target.value })}>
              <option value="">{o('allPaymentStatuses')}</option>
              {PAYMENT_STATUSES.map((value) => (
                <option key={value} value={value}>{orders.label('payment', value)}</option>
              ))}
            </Select>
          </Field>
          <Field label={o('paymentMethod')}>
            <Select value={state.paymentMethod} aria-label={o('paymentMethod')} onChange={(event) => update({ paymentMethod: event.target.value })}>
              <option value="">{o('allPaymentMethods')}</option>
              {PAYMENT_METHODS.map((value) => (
                <option key={value} value={value}>{orders.label('method', value)}</option>
              ))}
            </Select>
          </Field>
          <Field label={o('deliveryMethod')}>
            <Select value={state.deliveryMethod} aria-label={o('deliveryMethod')} onChange={(event) => update({ deliveryMethod: event.target.value })}>
              <option value="">{o('allDeliveryMethods')}</option>
              {DELIVERY_METHODS.map((value) => (
                <option key={value} value={value}>{orders.label('delivery', value)}</option>
              ))}
            </Select>
          </Field>
          <Field label={o('dateFrom')}>
            <Input type="date" value={state.from} max={state.to || undefined} aria-label={o('dateFrom')} onChange={(event) => update({ from: event.target.value })} />
          </Field>
          <Field label={o('dateTo')}>
            <Input type="date" value={state.to} min={state.from || undefined} aria-label={o('dateTo')} onChange={(event) => update({ to: event.target.value })} />
          </Field>
          <Field label={o('sortLabel')}>
            <Select value={state.sort} aria-label={o('sortLabel')} onChange={(event) => update({ sort: event.target.value })}>
              <option value="-created_at">{o('sortNewest')}</option>
              <option value="created_at">{o('sortOldest')}</option>
              <option value="-total">{o('sortTotalDesc')}</option>
              <option value="total">{o('sortTotalAsc')}</option>
            </Select>
          </Field>
          {hasFilters ? (
            <div className="flex items-end">
              <Button
                type="button"
                variant="ghost"
                className="min-h-11"
                onClick={() => {
                  setSearchInput('');
                  update({ q: '', paymentStatus: '', paymentMethod: '', deliveryMethod: '', from: '', to: '' });
                }}
              >
                {common('clearFilters')}
              </Button>
            </div>
          ) : null}
        </div>
      </section>

      {errorKind === 'forbidden' ? (
        <EmptyState icon={ClipboardList} title={o('forbidden')} description={`${o('restrictedHint')} ${o('capabilityHint')}`} />
      ) : (
        <>
          <DataTable<OrderSummary>
            columns={columns}
            data={rows}
            loading={loading}
            showToolbar={false}
            error={errorMessage}
            onRetry={() => setReloadToken((value) => value + 1)}
            retryLabel={common('retry')}
            emptyLabel={hasFilters ? o('emptyFilteredTitle') : o('emptyTitle')}
            emptyDescription={hasFilters ? o('emptyFilteredDescription') : o('emptyDescription')}
            serverSort={{ value: state.sort, columns: [...ORDERS_SORT_COLUMNS], onChange: (value) => update({ sort: value }) }}
            mobileRecord={(order) => ({
              title: (
                <button type="button" aria-label={t('openAria', { number: order.number })} className="num min-h-8 text-primary hover:underline" onClick={() => setSelectedId(order.id)}>
                  {order.number}
                </button>
              ),
              subtitle: order.customer.name ?? '—',
              caption: methodLabel(order),
              amount: formatOrderMoney(order.total),
              amountLabel: o('total'),
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

      <OrderSheet orderId={selectedId} storeId={storeId} onClose={() => setSelectedId(null)} />
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
