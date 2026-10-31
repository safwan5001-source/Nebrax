'use client';

import Link from 'next/link';
import { useLocale } from 'next-intl';
import { ArrowUpRight, CircleCheck, CircleDashed, CircleHelp, TriangleAlert } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { formatDateTime } from '@/lib/formatting';
import { useCan } from '@/lib/use-can';
import { withStoreParam } from '@/modules/commerce-workspace/active-store';
import { lifecycleOf } from '@/modules/commerce-workspace/orders/contract';
import { OrderStatusBadge, formatOrderMoney } from '@/modules/commerce-workspace/orders/order-display';
import { useWholesaleChannel } from '../../channel-context';
import { ResourceBoundary } from '../../components/resource-boundary';
import { StatCard } from '../../components/stat-card';
import { commonMessages } from '../../messages/common';
import { WHOLESALE_BASE } from '../../nav';
import { useResource, type ResourceState } from '../../use-resource';
import { buildAlerts, buildChecklist, type CheckState, type SettingsView } from './checklist';
import { fetchMembershipOverview, fetchRecentOrders } from './data';
import { overviewMessages, type OverviewMessageKey } from './messages';

const STATE_ICON = { done: CircleCheck, todo: CircleDashed, unknown: CircleHelp } as const;
const STATE_TONE: Record<CheckState, string> = { done: 'text-positive', todo: 'text-warning', unknown: 'text-muted' };

/** Overview — readiness checklist and alerts always; indicators and lists only when wholesale is active and permitted. */
export function OverviewSection() {
  const locale = useLocale();
  const { t } = overviewMessages.forLocale(locale);
  const common = commonMessages.forLocale(locale).t;
  const { channelId, store, settings, readiness } = useWholesaleChannel();
  const { can } = useCan();
  const storeId = store?.id ?? null;
  const active = readiness === 'active' && channelId !== null;
  const canOrders = can('commerce.orders.view');
  const canBuyers = can('commerce.wholesale.manage');

  const orders = useResource(() => fetchRecentOrders(channelId!), [channelId], { enabled: active && canOrders });
  const buyers = useResource(() => fetchMembershipOverview(channelId!), [channelId], { enabled: active && canBuyers });

  const settingsView: SettingsView = settings.status === 'ready' ? settings : settings.status === 'error' ? { status: 'error' } : { status: 'loading' };
  const checklist = buildChecklist(settingsView);
  const pendingCount = buyers.state.status === 'ready' ? buyers.state.data.pending.total : null;
  const alerts = buildAlerts(settingsView, pendingCount);
  const href = (path: string) => withStoreParam(path, storeId);

  return (
    <div className="space-y-5">
      <p className="max-w-3xl text-sm leading-relaxed text-muted">{t('description')}</p>

      <div className="grid gap-4 lg:grid-cols-2">
        <section aria-labelledby="wh-checklist" className="rounded border border-border bg-surface p-4">
          <h2 id="wh-checklist" className="text-sm font-semibold text-text">{t('checklistTitle')}</h2>
          <p className="mt-0.5 text-xs text-muted">{t('checklistHint')}</p>
          <ul className="mt-3 divide-y divide-border">
            {checklist.map((item) => {
              const Icon = STATE_ICON[item.state];
              const detail =
                item.state === 'unknown'
                  ? t('check.unknown')
                  : t(`check.${item.key}.${item.state}` as OverviewMessageKey, { name: item.detail ?? '' });
              return (
                <li key={item.key} className="flex items-start gap-3 py-2.5">
                  <Icon aria-hidden className={`mt-0.5 h-5 w-5 shrink-0 ${STATE_TONE[item.state]}`} strokeWidth={1.7} />
                  <div className="min-w-0 flex-1">
                    <p className="text-sm font-medium text-text">
                      {t(`check.${item.key}` as OverviewMessageKey)}
                      <span className="ms-2 text-xs font-normal text-muted">({t(`state.${item.state}` as OverviewMessageKey)})</span>
                    </p>
                    <p className="text-xs leading-relaxed text-muted">{detail}</p>
                  </div>
                  {item.key === 'priceList' ? (
                    <Button asChild variant="outline" size="sm" className="min-h-11 shrink-0 sm:min-h-8">
                      <Link href={href(`${WHOLESALE_BASE}/price-lists`)}>{t('goPriceLists')}</Link>
                    </Button>
                  ) : item.key === 'marked' ? (
                    <Button asChild variant="outline" size="sm" className="min-h-11 shrink-0 sm:min-h-8">
                      <Link href={href(`${WHOLESALE_BASE}/settings`)}>{t('goSettings')}</Link>
                    </Button>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </section>

        <section aria-labelledby="wh-alerts" className="rounded border border-border bg-surface p-4">
          <h2 id="wh-alerts" className="text-sm font-semibold text-text">{t('alertsTitle')}</h2>
          {alerts.length === 0 ? (
            <p className="mt-3 text-sm text-muted">{t('alertsNone')}</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {alerts.map((alert) => (
                <li key={alert.key} className="flex items-start gap-2 rounded border border-warning/30 bg-warning/10 p-2.5 text-sm text-text">
                  <TriangleAlert aria-hidden className="mt-0.5 h-4 w-4 shrink-0 text-warning" strokeWidth={1.7} />
                  <span className="min-w-0 flex-1">{t(`alert.${alert.key}` as OverviewMessageKey, alert.vars)}</span>
                  {alert.key === 'pending' ? (
                    <Link className="shrink-0 text-xs font-medium text-primary hover:underline" href={href(`${WHOLESALE_BASE}/buyers`)}>{t('alertReview')}</Link>
                  ) : null}
                </li>
              ))}
            </ul>
          )}
        </section>
      </div>

      {!active ? (
        <p role="status" className="rounded border border-dashed border-border bg-surface p-4 text-sm text-muted">
          {readiness === 'loading' ? common('loading') : t('gateNotice')}
        </p>
      ) : (
        <>
          <section aria-labelledby="wh-kpis" className="space-y-2">
            <h2 id="wh-kpis" className="text-sm font-semibold text-text">{t('kpiTitle')}</h2>
            <div className="grid grid-cols-2 gap-3 xl:grid-cols-4">
              <Kpi
                label={t('kpiOrders')}
                permitted={canOrders}
                state={orders.state}
                value={(d) => d.total}
                link={href('/commerce/wholesale/orders')}
              />
              <Kpi label={t('kpiPending')} permitted={canBuyers} state={buyers.state} value={(d) => d.pending.total} link={href(`${WHOLESALE_BASE}/buyers`)} />
              <Kpi label={t('kpiApproved')} permitted={canBuyers} state={buyers.state} value={(d) => d.approved} link={href(`${WHOLESALE_BASE}/buyers`)} />
              <Kpi label={t('kpiSuspended')} permitted={canBuyers} state={buyers.state} value={(d) => d.suspended} link={href(`${WHOLESALE_BASE}/buyers`)} />
            </div>
          </section>

          <div className="grid gap-4 lg:grid-cols-2">
            <section aria-labelledby="wh-recent" className="rounded border border-border bg-surface p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 id="wh-recent" className="text-sm font-semibold text-text">{t('recentOrdersTitle')}</h2>
                {canOrders ? <Link className="text-xs font-medium text-primary hover:underline" href={href(`${WHOLESALE_BASE}/orders`)}>{t('allOrders')}</Link> : null}
              </div>
              <div className="mt-3">
                {!canOrders ? (
                  <p className="text-sm text-muted">{t('noPermissionSection')}</p>
                ) : (
                  <ResourceBoundary state={orders.state} onRetry={orders.reload} loadingVariant="cards" loadingRows={2}>
                    {({ rows }) =>
                      rows.length === 0 ? (
                        <p className="text-sm text-muted">{t('recentOrdersEmpty')}</p>
                      ) : (
                        <ul className="divide-y divide-border">
                          {rows.map((order) => (
                            <li key={order.id} className="flex min-h-11 items-center justify-between gap-3 py-2">
                              <div className="min-w-0">
                                <Link href={href(`/commerce/orders/${order.id}`)} className="num text-sm text-primary hover:underline">{order.number}</Link>
                                <bdi className="block truncate text-xs text-muted">{order.customer.name ?? '—'} · {formatDateTime(order.created_at, locale)}</bdi>
                              </div>
                              <div className="flex shrink-0 flex-col items-end gap-1">
                                <span className="num text-sm">{formatOrderMoney(order.total)}</span>
                                <OrderStatusBadge status={lifecycleOf(order)} locale={locale} />
                              </div>
                            </li>
                          ))}
                        </ul>
                      )
                    }
                  </ResourceBoundary>
                )}
              </div>
            </section>

            <section aria-labelledby="wh-pending" className="rounded border border-border bg-surface p-4">
              <div className="flex items-center justify-between gap-2">
                <h2 id="wh-pending" className="text-sm font-semibold text-text">{t('pendingTitle')}</h2>
                {canBuyers ? <Link className="text-xs font-medium text-primary hover:underline" href={href(`${WHOLESALE_BASE}/buyers`)}>{t('allBuyers')}</Link> : null}
              </div>
              <div className="mt-3">
                {!canBuyers ? (
                  <p className="text-sm text-muted">{t('noPermissionSection')}</p>
                ) : (
                  <ResourceBoundary state={buyers.state} onRetry={buyers.reload} loadingVariant="cards" loadingRows={2}>
                    {({ pending }) =>
                      pending.rows.length === 0 ? (
                        <p className="text-sm text-muted">{t('pendingEmpty')}</p>
                      ) : (
                        <ul className="divide-y divide-border">
                          {pending.rows.map((m) => (
                            <li key={m.id} className="flex min-h-11 items-center justify-between gap-3 py-2">
                              <div className="min-w-0">
                                <bdi className="block truncate text-sm font-medium text-text">{m.customer.display_name ?? t('unnamedBuyer')}</bdi>
                                <span className="block truncate text-xs text-muted" dir="ltr">{m.customer.email ?? m.customer.phone ?? '—'}</span>
                              </div>
                              <span className="num shrink-0 text-xs text-muted">{t('appliedOn', { date: formatDateTime(m.applied_at, locale) })}</span>
                            </li>
                          ))}
                        </ul>
                      )
                    }
                  </ResourceBoundary>
                )}
              </div>
            </section>
          </div>
        </>
      )}
    </div>
  );
}

/** One indicator: a real number, a skeleton, or an explicit reason it is unavailable — never a placeholder zero. */
function Kpi<T>({
  label,
  permitted,
  state,
  value,
  link,
}: {
  label: string;
  permitted: boolean;
  state: ResourceState<T>;
  value: (data: T) => number;
  link: string;
}) {
  const { t } = overviewMessages.forLocale(useLocale());
  const open = (
    <Link href={link} aria-label={`${t('kpiOpen')}: ${label}`} className="inline-flex h-6 w-6 items-center justify-center rounded text-muted hover:text-primary">
      <ArrowUpRight aria-hidden className="h-4 w-4 rtl:-scale-x-100" strokeWidth={1.7} />
    </Link>
  );

  if (!permitted) return <StatCard label={label} unavailable={t('kpiNoPermission')} />;
  if (state.status === 'loading') return <StatCard label={label} loading />;
  if (state.status === 'error') return <StatCard label={label} unavailable={state.kind === 'forbidden' ? t('kpiNoPermission') : t('kpiLoadError')} />;
  return <StatCard label={label} value={value(state.data)} href={open} />;
}
