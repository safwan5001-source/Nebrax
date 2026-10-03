'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { DeliveryHubWorkspace } from '@/components/delivery-hub/delivery-hub-workspace';
import { api, ApiError } from '@/lib/api';
import { currentUser } from '@/lib/auth';
import {
  deliveryHubListPath,
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
  const [mounted, setMounted] = useState(false);
  const [orders, setOrders] = useState<DeliveryHubOrderView[]>([]);
  const [context, setContext] = useState<HubContext>({ can_see_unrouted: false, platforms: [], branches: [] });
  const [state, setState] = useState<DeliveryHubState | 'all'>('all');
  const [platformId, setPlatformId] = useState('');
  const [branchId, setBranchId] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [lastPage, setLastPage] = useState(1);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const requestSeq = useRef(0);

  useEffect(() => { setMounted(true); }, []);

  const user = mounted ? currentUser() : null;
  const canView = mounted && hasPermission(user?.permissions, user?.role, 'delivery_hub.view');
  const canOperate = canView && hasPermission(user?.permissions, user?.role, 'delivery_hub.operate');

  const load = useCallback(() => {
    const seq = ++requestSeq.current;
    let clamped = false;
    setError(null);
    setLoading(true);
    api<{ data: DeliveryHubOrderView[]; meta?: { last_page?: number } }>(
      deliveryHubListPath({ state, platformId, branchId, page }),
    )
      .then((result) => {
        if (seq !== requestSeq.current) return;
        const last = Math.max(1, result.meta?.last_page ?? 1);
        setLastPage(last);
        if (page > last) {
          clamped = true;
          setOrders([]);
          setPage(last);
          return;
        }
        setOrders(result.data);
        setSelectedId((current) => (current && result.data.some((order) => order.id === current) ? current : null));
      })
      .catch((caught) => {
        if (seq !== requestSeq.current) return;
        setError(caught instanceof ApiError ? caught.message : t('loadFailed'));
      })
      .finally(() => {
        if (seq !== requestSeq.current || clamped) return;
        setLoading(false);
      });
  }, [branchId, page, platformId, state, t]);

  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    if (!canView) return;
    api<{ data: HubContext }>('/delivery-hub/context')
      .then((result) => setContext(result.data))
      .catch(() => setContext({ can_see_unrouted: false, platforms: [], branches: [] }));
  }, [canView]);

  useEffect(() => {
    if (!canView) return;
    load();
  }, [canView, load]);

  function changeState(next: DeliveryHubState | 'all'): void {
    if (next === 'unrouted' && !context.can_see_unrouted) return;
    setState(next);
    setPage(1);
    setSelectedId(null);
  }

  function act(order: DeliveryHubOrderView, action: DeliveryHubAction, destinationBranchId: string | null): void {
    if (!canOperate) return;
    const apiAction = action === 'reroute' ? 'route' : action;
    const seqAtStart = requestSeq.current;
    setBusy(true);
    setError(null);
    api<{ data: DeliveryHubOrderView }>(`/delivery-hub/orders/${order.id}/transition`, {
      method: 'POST',
      body: { action: apiAction, branch_id: destinationBranchId },
    })
      .then(() => loadRef.current())
      .catch((caught) => {
        if (requestSeq.current !== seqAtStart) return;
        setError(caught instanceof ApiError ? caught.message : t('actionFailed'));
      })
      .finally(() => setBusy(false));
  }

  if (!mounted) {
    return <div className="min-h-11" data-testid="delivery-hub-pending" />;
  }

  if (!canView) {
    return (
      <section className="space-y-2" data-testid="delivery-hub-forbidden">
        <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
        <p role="status" className="text-sm text-text">{t('viewForbidden')}</p>
      </section>
    );
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
      loading={loading}
      error={error}
      page={page}
      lastPage={lastPage}
      onState={changeState}
      onPlatform={(id) => { setPlatformId(id); setPage(1); }}
      onBranch={(id) => { setBranchId(id); setPage(1); }}
      onSelect={setSelectedId}
      onPage={setPage}
      onAction={act}
    />
  );
}
