'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useTranslations } from 'next-intl';
import { DeliveryPlatformsWorkspace, type PlatformBranchOption } from '@/components/delivery-platforms/delivery-platforms-workspace';
import { api, ApiError } from '@/lib/api';
import { currentUser } from '@/lib/auth';
import {
  platformManagementRows,
  readPlatformProfiles,
  type PlatformManagementRow,
} from '@/lib/delivery-platform-management';
import { hasPermission } from '@/lib/permissions';

export default function DeliveryPlatformsPage() {
  const t = useTranslations('deliveryPlatforms');
  const [mounted, setMounted] = useState(false);
  const [rows, setRows] = useState<PlatformManagementRow[]>([]);
  const [branches, setBranches] = useState<PlatformBranchOption[]>([]);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [appEnabled, setAppEnabled] = useState<boolean | null>(null);
  const requestSeq = useRef(0);

  useEffect(() => { setMounted(true); }, []);
  const user = mounted ? currentUser() : null;
  const canView = mounted && hasPermission(user?.permissions, user?.role, 'invoices.view');
  const canManage = canView && hasPermission(user?.permissions, user?.role, 'company.manage');

  const load = useCallback(() => {
    const seq = ++requestSeq.current;
    setLoading(true);
    setError(null);
    api<{ data: unknown }>('/delivery-platforms')
      .then((result) => {
        if (seq !== requestSeq.current) return;
        const next = platformManagementRows(readPlatformProfiles(result.data));
        setRows(next);
        setSelectedKey((current) => (current && next.some((row) => row.key === current) ? current : null));
      })
      .catch((caught) => {
        if (seq !== requestSeq.current) return;
        setError(caught instanceof ApiError ? caught.message : t('loadFailed'));
      })
      .finally(() => {
        if (seq !== requestSeq.current) return;
        setLoading(false);
      });
  }, [t]);

  useEffect(() => {
    if (!canView) return;
    api<{ data: Record<string, boolean> | unknown }>('/applications/nav-state')
      .then((result) => {
        const data = result.data;
        setAppEnabled(Boolean(data && typeof data === 'object' && !Array.isArray(data) && data['sales.pos'] === true));
      })
      .catch(() => setAppEnabled(false));
  }, [canView]);

  useEffect(() => {
    if (!canView || appEnabled !== true) return;
    load();
    api<{ data: Array<{ id?: string; name?: string; is_active?: boolean }> }>('/branches')
      .then((result) => {
        setBranches(Array.isArray(result.data)
          ? result.data.flatMap((branch) => typeof branch.id === 'string' && typeof branch.name === 'string'
            ? [{ id: branch.id, name: branch.name, is_active: branch.is_active !== false }]
            : [])
          : []);
      })
      .catch(() => setBranches([]));
  }, [appEnabled, canView, load]);

  function save(profileId: string | null, body: Record<string, unknown>): void {
    if (!canManage) return;
    setBusy(true);
    setError(null);
    const path = profileId ? `/delivery-platforms/${profileId}` : '/delivery-platforms';
    api(path, { method: profileId ? 'PUT' : 'POST', body })
      .then(() => load())
      .catch((caught) => setError(caught instanceof ApiError ? caught.message : t('saveFailed')))
      .finally(() => setBusy(false));
  }

  if (!mounted) return <div className="min-h-11" data-testid="delivery-platforms-pending" />;

  if (!canView) {
    return (
      <section className="space-y-2" data-testid="delivery-platforms-forbidden">
        <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
        <p role="status" className="text-sm text-text">{t('viewForbidden')}</p>
      </section>
    );
  }

  if (appEnabled === false) {
    return (
      <section className="space-y-2">
        <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
        <p role="status" className="text-sm text-text">{t('appDisabled')}</p>
      </section>
    );
  }

  return (
    <DeliveryPlatformsWorkspace
      rows={rows}
      branches={branches}
      canManage={canManage}
      selectedKey={selectedKey}
      busy={busy}
      loading={loading || appEnabled === null}
      error={error}
      onSelect={setSelectedKey}
      onSave={save}
    />
  );
}
