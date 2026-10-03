'use client';

import { useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { DeliveryPlatformMark } from '@/components/delivery/delivery-platform-mark';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import {
  deliveryHubActions,
  deliveryHubPlatformLabel,
  type DeliveryHubAction,
  type DeliveryHubBranchOption,
  type DeliveryHubOrderView,
  type DeliveryHubState,
} from '@/lib/delivery-hub';

const TABS: Array<DeliveryHubState | 'all'> = ['all', 'unrouted', 'received', 'accepted', 'preparing', 'ready', 'handed_off', 'cancelled_before_post'];

function stateTone(state: DeliveryHubState): 'neutral' | 'muted' | 'warning' | 'negative' {
  if (state === 'cancelled_before_post') return 'negative';
  if (state === 'preparing' || state === 'ready') return 'warning';
  if (state === 'unrouted' || state === 'handed_off') return 'muted';
  return 'neutral';
}

export function DeliveryHubWorkspace({
  orders,
  branches,
  platforms,
  state,
  platformId,
  branchId,
  canOperate,
  canSeeUnrouted,
  selectedId,
  busy,
  error,
  onState,
  onPlatform,
  onBranch,
  onSelect,
  onAction,
}: {
  orders: DeliveryHubOrderView[];
  branches: DeliveryHubBranchOption[];
  platforms: Array<{ id: string; platform_key: string; name: string | null; name_en: string | null }>;
  state: DeliveryHubState | 'all';
  platformId: string;
  branchId: string;
  canOperate: boolean;
  canSeeUnrouted: boolean;
  selectedId: string | null;
  busy: boolean;
  error: string | null;
  onState: (state: DeliveryHubState | 'all') => void;
  onPlatform: (id: string) => void;
  onBranch: (id: string) => void;
  onSelect: (id: string | null) => void;
  onAction: (order: DeliveryHubOrderView, action: DeliveryHubAction, destinationBranchId: string | null) => void;
}) {
  const t = useTranslations('deliveryHub');
  const locale = useLocale();
  const tabs = TABS.filter((tab) => tab !== 'unrouted' || canSeeUnrouted);
  const selected = orders.find((order) => order.id === selectedId) ?? null;

  return (
    <div className="space-y-4 pb-16 md:pb-0" data-testid="delivery-hub-workspace">
      <header className="space-y-1">
        <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
        <p className="text-sm text-muted">{t('subtitle')}</p>
        <p className="text-sm font-medium text-text">{t('operationalOnly')}</p>
      </header>

      <div role="tablist" aria-label={t('states')} className="flex gap-2 overflow-x-auto">
        {tabs.map((tab) => (
          <button
            key={tab}
            type="button"
            role="tab"
            aria-selected={state === tab}
            onClick={() => onState(tab)}
            className={
              'min-h-11 shrink-0 rounded border px-3 text-sm font-medium focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ' +
              (state === tab ? 'border-primary bg-primary-soft text-text' : 'border-border bg-surface text-muted')
            }
          >
            {t(tab === 'all' ? 'all' : `state_${tab}`)}
          </button>
        ))}
      </div>

      <section className="grid grid-cols-1 gap-3 rounded border border-border bg-surface p-3 md:grid-cols-2" aria-label={t('filters')}>
        <div>
          <Label htmlFor="hub-platform">{t('filterPlatform')}</Label>
          <Select id="hub-platform" value={platformId} onChange={(event) => onPlatform(event.target.value)}>
            <option value="">{t('allPlatforms')}</option>
            {platforms.map((platform) => (
              <option key={platform.id} value={platform.id}>
                {locale === 'en' ? platform.name_en || platform.name || platform.platform_key : platform.name || platform.name_en || platform.platform_key}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <Label htmlFor="hub-branch">{t('filterBranch')}</Label>
          <Select id="hub-branch" value={branchId} onChange={(event) => onBranch(event.target.value)}>
            <option value="">{t('allBranches')}</option>
            {branches.map((branch) => (
              <option key={branch.id} value={branch.id}>{branch.name}</option>
            ))}
          </Select>
        </div>
      </section>

      {error ? <p role="alert" className="text-sm text-negative">{error}</p> : null}

      <div className="grid grid-cols-1 gap-4 md:grid-cols-[minmax(0,1fr)_22rem]">
        <div>
          <ul className="space-y-2 md:hidden" data-testid="delivery-hub-mobile-list">
            {orders.map((order) => (
              <li key={order.id}>
                <OrderButton order={order} locale={locale} selected={order.id === selectedId} label={t(`state_${order.state}`)} onSelect={onSelect} />
              </li>
            ))}
          </ul>
          <div className="hidden overflow-x-auto rounded border border-border md:block" data-testid="delivery-hub-desktop-table">
            <table className="w-full text-sm">
              <thead className="bg-surface text-muted">
                <tr>
                  <th className="px-3 py-2 text-start font-medium">{t('platform')}</th>
                  <th className="px-3 py-2 text-start font-medium">{t('reference')}</th>
                  <th className="px-3 py-2 text-start font-medium">{t('states')}</th>
                  <th className="px-3 py-2 text-start font-medium">{t('branch')}</th>
                </tr>
              </thead>
              <tbody>
                {orders.map((order) => (
                  <tr key={order.id} className="border-t border-border">
                    <td className="px-3 py-2">
                      <button type="button" className="min-h-11 text-start" onClick={() => onSelect(order.id)}>
                        <DeliveryPlatformMark platformKey={order.platform_key} name={deliveryHubPlatformLabel(order, locale)} />
                      </button>
                    </td>
                    <td className="px-3 py-2">{order.external_order_reference || order.provider_order_id || '—'}</td>
                    <td className="px-3 py-2"><Badge tone={stateTone(order.state)}>{t(`state_${order.state}`)}</Badge></td>
                    <td className="px-3 py-2">{order.branch_name || '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {orders.length === 0 ? <p className="mt-3 text-sm text-muted">{t('empty')}</p> : null}
        </div>
        <DeliveryHubDetail
          order={selected}
          branches={branches}
          canOperate={canOperate}
          canSeeUnrouted={canSeeUnrouted}
          busy={busy}
          locale={locale}
          onClose={() => onSelect(null)}
          onAction={onAction}
        />
      </div>
    </div>
  );
}

function OrderButton({
  order,
  locale,
  selected,
  label,
  onSelect,
}: {
  order: DeliveryHubOrderView;
  locale: string;
  selected: boolean;
  label: string;
  onSelect: (id: string) => void;
}) {
  return (
    <button
      type="button"
      aria-pressed={selected}
      onClick={() => onSelect(order.id)}
      className="flex w-full min-h-11 flex-col gap-2 rounded border border-border bg-surface p-3 text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary"
    >
      <DeliveryPlatformMark platformKey={order.platform_key} name={deliveryHubPlatformLabel(order, locale)} />
      <span className="text-sm text-text">{order.external_order_reference || order.provider_order_id || '—'}</span>
      <Badge tone={stateTone(order.state)}>{label}</Badge>
    </button>
  );
}

function DeliveryHubDetail({
  order,
  branches,
  canOperate,
  canSeeUnrouted,
  busy,
  locale,
  onClose,
  onAction,
}: {
  order: DeliveryHubOrderView | null;
  branches: DeliveryHubBranchOption[];
  canOperate: boolean;
  canSeeUnrouted: boolean;
  busy: boolean;
  locale: string;
  onClose: () => void;
  onAction: (order: DeliveryHubOrderView, action: DeliveryHubAction, destinationBranchId: string | null) => void;
}) {
  const t = useTranslations('deliveryHub');
  const [destination, setDestination] = useState('');
  if (!order) return null;

  const actions = deliveryHubActions({
    state: order.state,
    canOperate,
    canSeeUnrouted,
    branchCount: branches.length,
  });
  const destinations = branches.filter((branch) => branch.id !== order.branch_id);

  return (
    <aside className="space-y-3 rounded border border-border bg-surface p-4" data-testid="delivery-hub-detail" aria-label={t('detailTitle')}>
      <div className="flex items-start justify-between gap-2">
        <DeliveryPlatformMark platformKey={order.platform_key} name={deliveryHubPlatformLabel(order, locale)} />
        <Button type="button" variant="ghost" size="sm" onClick={onClose}>{t('close')}</Button>
      </div>
      <Badge tone={stateTone(order.state)}>{t(`state_${order.state}`)}</Badge>
      {order.state === 'handed_off' ? <p className="text-sm text-text">{t('handedOffHint')}</p> : null}
      <dl className="space-y-2 text-sm">
        <div><dt className="text-muted">{t('reference')}</dt><dd>{order.external_order_reference || '—'}</dd></div>
        <div><dt className="text-muted">{t('providerOrder')}</dt><dd>{order.provider_order_id || '—'}</dd></div>
        <div><dt className="text-muted">{t('branch')}</dt><dd>{order.branch_name || '—'}</dd></div>
        <div><dt className="text-muted">{t('createdAt')}</dt><dd>{order.created_at || '—'}</dd></div>
        <div><dt className="text-muted">{t('updatedAt')}</dt><dd>{order.updated_at || '—'}</dd></div>
        <div>
          <dt className="text-muted">{t('providerStatus')}</dt>
          <dd>{order.provider_status || '—'}</dd>
          <dd className="text-muted">{t('providerStatusHint')}</dd>
        </div>
      </dl>
      <p className="text-sm font-medium text-text">{t('noFinancial')}</p>
      {actions.length === 0 ? <p className="text-sm text-muted">{canOperate ? t('noActions') : t('viewOnly')}</p> : null}
      {actions.includes('route') || actions.includes('reroute') ? (
        <div>
          <Label htmlFor="hub-destination">{t('destination')}</Label>
          <Select id="hub-destination" value={destination} onChange={(event) => setDestination(event.target.value)}>
            <option value="">{t('destination')}</option>
            {destinations.map((branch) => <option key={branch.id} value={branch.id}>{branch.name}</option>)}
          </Select>
        </div>
      ) : null}
      <div className="flex flex-wrap gap-2">
        {actions.map((action) => (
          <Button
            key={action}
            type="button"
            variant={action === 'cancel' || action === 'reject' ? 'outline' : 'primary'}
            disabled={busy || ((action === 'route' || action === 'reroute') && destination === '')}
            onClick={() => onAction(order, action, action === 'route' || action === 'reroute' ? destination : null)}
          >
            {t(action)}
          </Button>
        ))}
      </div>
    </aside>
  );
}
