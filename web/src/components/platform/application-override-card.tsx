'use client';

import * as React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Eye, EyeOff, RefreshCw, Search, Shield, Undo2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api';
import { platformApi } from '@/lib/platform-api';

type CommercialMode = 'inherit' | 'granted' | 'denied';
type OperationalState = 'enabled' | 'disabled' | 'suspended';
type EffectiveAccess = 'allowed' | 'read_only' | 'denied' | 'full';
type BulkAction = 'grant_all' | 'revert_all' | 'show_all' | 'hide_all';
type RowAction = 'grant' | 'revert' | 'show' | 'hide';

interface OverrideApplication {
  key: string;
  group: string;
  maturity: 'built' | 'coming_soon' | 'retired';
  mandatory: boolean;
  access: 'operational' | 'commercial';
  commercial_mode: CommercialMode;
  override_grant_id: string | null;
  operational_status: OperationalState;
  effective_access: EffectiveAccess;
  can_grant: boolean;
  can_revert: boolean;
  can_show: boolean;
  can_hide: boolean;
  skip_reasons: Record<RowAction, string[]>;
}

interface PreviewRow {
  application_key: string;
  outcome: 'applied' | 'skipped';
  skip_reasons: string[];
  notes?: string[];
}

interface BulkPreview {
  action: BulkAction;
  results: PreviewRow[];
}

const commercialModeTone: Record<CommercialMode, 'positive' | 'neutral' | 'warning' | 'muted' | 'negative'> = {
  inherit: 'positive',
  granted: 'warning',
  denied: 'negative',
};

const operationalTone: Record<OperationalState, 'positive' | 'negative' | 'warning'> = {
  enabled: 'positive',
  disabled: 'negative',
  suspended: 'warning',
};

function catalogKeyLabel(key: string): string {
  return key.replaceAll('.', '_');
}

export function ApplicationOverrideCard({ tenantId, onChanged }: { tenantId: string; onChanged?: () => void }) {
  const t = useTranslations('platform.applicationOverrides');
  const tApps = useTranslations('applications');
  const [applications, setApplications] = useState<OverrideApplication[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'commercial' | 'built'>('all');
  const [acting, setActing] = useState(false);
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<BulkPreview | PreviewRow | null>(null);
  const [pendingAction, setPendingAction] = useState<{ type: 'row'; action: RowAction; key: string } | { type: 'bulk'; action: BulkAction } | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const response = await platformApi<{ data: { applications: OverrideApplication[] } }>(
        `/platform/tenants/${tenantId}/application-overrides/summary`,
      );
      setApplications(response.data.applications);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t, tenantId]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => applications.filter((app) => {
    const label = tApps(`keys.${catalogKeyLabel(app.key)}`);
    const matchesSearch = !search || app.key.includes(search) || label.includes(search);
    const matchesFilter = filter === 'all'
      || (filter === 'commercial' && app.access === 'commercial')
      || (filter === 'built' && app.maturity === 'built' && !app.mandatory);
    return matchesSearch && matchesFilter;
  }), [applications, filter, search, tApps]);

  async function openPreview(action: RowAction, key: string) {
    setActing(true);
    setError(null);
    try {
      const response = await platformApi<{ data: PreviewRow }>(`/platform/tenants/${tenantId}/application-overrides/preview`, {
        method: 'POST',
        body: { action, application_key: key },
      });
      setPreview(response.data);
      setPendingAction({ type: 'row', action, key });
      setReason('');
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : t('previewFailed'));
    } finally {
      setActing(false);
    }
  }

  async function openBulkPreview(action: BulkAction) {
    setActing(true);
    setError(null);
    try {
      const response = await platformApi<{ data: BulkPreview }>(`/platform/tenants/${tenantId}/application-overrides/preview`, {
        method: 'POST',
        body: { action, keys: filtered.map((app) => app.key) },
      });
      setPreview(response.data);
      setPendingAction({ type: 'bulk', action });
      setReason('');
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : t('previewFailed'));
    } finally {
      setActing(false);
    }
  }

  async function applyPending() {
    if (!pendingAction) return;
    setActing(true);
    setError(null);
    try {
      if (pendingAction.type === 'row') {
        await platformApi(`/platform/tenants/${tenantId}/application-overrides/${pendingAction.action}`, {
          method: 'POST',
          body: { application_key: pendingAction.key, reason: reason || null },
        });
      } else {
        await platformApi(`/platform/tenants/${tenantId}/application-overrides/bulk`, {
          method: 'POST',
          body: { action: pendingAction.action, keys: filtered.map((app) => app.key), reason: reason || null },
        });
      }
      setPreview(null);
      setPendingAction(null);
      await load();
      onChanged?.();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : t('applyFailed'));
    } finally {
      setActing(false);
    }
  }

  const previewRows: PreviewRow[] = preview && 'results' in preview
    ? preview.results
    : preview
      ? [preview]
      : [];

  return (
    <Card>
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Shield className="h-5 w-5 text-primary" strokeWidth={1.7} aria-hidden="true" />
            {t('title')}
          </CardTitle>
          <p className="mt-1 text-sm text-muted">{t('subtitle')}</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
          {t('refresh')}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p className="text-sm text-negative" role="alert">{error}</p>}

        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-1 flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" strokeWidth={1.7} aria-hidden="true" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('search')} className="ps-9" />
            </div>
            <Select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} className="w-full sm:w-44">
              <option value="all">{t('filterAll')}</option>
              <option value="commercial">{t('filterCommercial')}</option>
              <option value="built">{t('filterBuilt')}</option>
            </Select>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button variant="outline" size="sm" onClick={() => openBulkPreview('grant_all')} disabled={acting}>{t('bulkGrant')}</Button>
            <Button variant="outline" size="sm" onClick={() => openBulkPreview('revert_all')} disabled={acting}>{t('bulkRevert')}</Button>
            <Button variant="outline" size="sm" onClick={() => openBulkPreview('show_all')} disabled={acting}>{t('bulkShow')}</Button>
            <Button variant="outline" size="sm" onClick={() => openBulkPreview('hide_all')} disabled={acting}>{t('bulkHide')}</Button>
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-muted">{t('loading')}</p>
        ) : (
          <div className="overflow-x-auto rounded border border-border">
            <table className="min-w-full text-sm">
              <thead className="bg-surface text-muted">
                <tr>
                  <th className="px-3 py-2 text-start font-medium">{t('columns.app')}</th>
                  <th className="px-3 py-2 text-start font-medium">{t('columns.commercial')}</th>
                  <th className="px-3 py-2 text-start font-medium">{t('columns.operational')}</th>
                  <th className="px-3 py-2 text-start font-medium">{t('columns.effective')}</th>
                  <th className="px-3 py-2 text-start font-medium">{t('columns.actions')}</th>
                </tr>
              </thead>
              <tbody>
                {filtered.map((app) => (
                  <tr key={app.key} className="border-t border-border">
                    <td className="px-3 py-2">
                      <div className="font-medium text-text">{tApps(`keys.${catalogKeyLabel(app.key)}`)}</div>
                      <div className="text-xs text-muted" dir="ltr">{app.key}</div>
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={commercialModeTone[app.commercial_mode]}>{t(`commercialMode.${app.commercial_mode}`)}</Badge>
                    </td>
                    <td className="px-3 py-2">
                      <Badge tone={operationalTone[app.operational_status]}>{t(`operational.${app.operational_status}`)}</Badge>
                    </td>
                    <td className="px-3 py-2">
                      <span className="text-text">{t(`effective.${app.effective_access}`)}</span>
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex flex-wrap gap-1">
                        {app.access === 'commercial' && (
                          <Button variant="ghost" size="sm" disabled={!app.can_grant || acting} onClick={() => openPreview('grant', app.key)} title={t('grant')}>
                            <Shield className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
                          </Button>
                        )}
                        {app.access === 'commercial' && (
                          <Button variant="ghost" size="sm" disabled={!app.can_revert || acting} onClick={() => openPreview('revert', app.key)} title={t('revert')}>
                            <Undo2 className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
                          </Button>
                        )}
                        <Button variant="ghost" size="sm" disabled={!app.can_show || acting} onClick={() => openPreview('show', app.key)} title={t('show')}>
                          <Eye className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
                        </Button>
                        <Button variant="ghost" size="sm" disabled={!app.can_hide || acting} onClick={() => openPreview('hide', app.key)} title={t('hide')}>
                          <EyeOff className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />
                        </Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </CardContent>

      <Dialog
        open={preview !== null}
        onClose={() => { setPreview(null); setPendingAction(null); }}
        title={t('previewTitle')}
        className="max-w-3xl"
      >
        <div className="space-y-4 p-4">
          <div className="max-h-64 overflow-y-auto rounded border border-border">
            <table className="min-w-full text-sm">
              <thead className="bg-surface text-muted">
                <tr>
                  <th className="px-3 py-2 text-start">{t('columns.app')}</th>
                  <th className="px-3 py-2 text-start">{t('previewOutcome')}</th>
                  <th className="px-3 py-2 text-start">{t('previewDetails')}</th>
                </tr>
              </thead>
              <tbody>
                {previewRows.map((row) => (
                  <tr key={row.application_key} className="border-t border-border">
                    <td className="px-3 py-2">{tApps(`keys.${catalogKeyLabel(row.application_key)}`)}</td>
                    <td className="px-3 py-2">
                      <Badge tone={row.outcome === 'applied' ? 'positive' : 'muted'}>
                        {row.outcome === 'applied' ? t('outcomeApplied') : t('outcomeSkipped')}
                      </Badge>
                    </td>
                    <td className="px-3 py-2 text-muted">
                      {row.skip_reasons.length > 0 ? row.skip_reasons.join(' · ') : (row.notes?.join(' · ') ?? '—')}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div>
            <Label htmlFor="override-reason">{t('reasonLabel')}</Label>
            <Textarea id="override-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="mt-1.5" />
          </div>
          <div className="flex justify-end gap-2">
            <Button variant="outline" onClick={() => { setPreview(null); setPendingAction(null); }}>{t('cancel')}</Button>
            <Button onClick={applyPending} disabled={acting || previewRows.every((row) => row.outcome === 'skipped')}>
              {acting ? t('applying') : t('confirmApply')}
            </Button>
          </div>
        </div>
      </Dialog>
    </Card>
  );
}
