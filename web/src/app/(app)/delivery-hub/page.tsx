'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { DeliveryHubWorkspace } from '@/components/delivery-hub/delivery-hub-workspace';
import { api, ApiError } from '@/lib/api';
import { currentUser } from '@/lib/auth';
import {
  type DeliveryHubAction,
  type DeliveryHubBranchOption,
  type DeliveryHubOrderView,
  type DeliveryHubState,
} from '@/lib/delivery-hub';
import { hasPermission } from '@/lib/permissions';

interface HubContext {
  can_see_unrouted: boolean;
  platforms: Array<{ id: string; platform_key: string; name: string | null; name_en: string | null }>;
  branches: DeliveryHubBranchOption[];
}

export default function DeliveryHubPage() {
  const t = useTranslations('deliveryHub');
  const user = currentUser();
  const canOperate = hasPermission(user?.permissions, user?.role, 'delivery_hub.operate');
  const [orders, setOrders] = useState<DeliveryHubOrderView[]>([]);
  const [context, setContext] = useState<HubContext>({ can_see_unrouted: false, platforms: [], branches: [] });
  const [state, setState] = useState<DeliveryHubState | 'all'>('all');
  const [platformId, setPlatformId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    const params = new URLSearchParams({ per_page: '50' });
    if (state === 'unrouted') params.set('unrouted', '1');
    else if (state !== 'all') params.set('state', state);
    if (platformId) params.set('delivery_platform_profile_id', platformId);
    if (branchId) params.set('branch_id', branchId);
    setError(null);
    api<{ data: DeliveryHubOrderView[] }>(`/delivery-hub/orders?${params.toString()}`)
      .then((result) => {
        setOrders(result.data);
        setSelectedId((current) => (current && result.data.some((order) => order.id === current) ? current : null));
      })
      .catch((caught) => setError(caught instanceof ApiError ? caught.message : t('loadFailed')));
  }, [branchId, platformId, state, t]);

  useEffect(() => {
    api<{ data: HubContext }>('/delivery-hub/context')
      .then((result) => setContext(result.data))
      .catch(() => setContext({ can_see_unrouted: false, platforms: [], branches: [] }));
  }, []);

  useEffect(() => { load(); }, [load]);

  function changeState(next: DeliveryHubState | 'all'): void {
    if (next === 'unrouted' && !context.can_see_unrouted) return;
    setState(next);
    setSelectedId(null);
  }

  function act(order: DeliveryHubOrderView, action: DeliveryHubAction, destinationBranchId: string | null): void {
    const apiAction = action === 'reroute' ? 'route' : action;
    setBusy(true);
    setError(null);
    api<{ data: DeliveryHubOrderView }>(`/delivery-hub/orders/${order.id}/transition`, {
      method: 'POST',
      body: { action: apiAction, branch_id: destinationBranchId },
    })
      .then(() => load())
      .catch((caught) => setError(caught instanceof ApiError ? caught.message : t('loadFailed')))
      .finally(() => setBusy(false));
  }

  return (
    <DeliveryHubWorkspace
      orders={orders}
      branches={context.branches}
      platforms={context.platforms}
      state={state}
      platformId={platformId}
      branchId={branchId}
      canOperate={canOperate}
      canSeeUnrouted={context.can_see_unrouted}
      selectedId={selectedId}
      busy={busy}
      error={error}
      onState={changeState}
      onPlatform={setPlatformId}
      onBranch={setBranchId}
      onSelect={setSelectedId}
      onAction={act}
    />
  );
}
