'use client';

import * as React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Eye, EyeOff, Globe, MoreHorizontal, RefreshCw, Search, Shield, Undo2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Dropdown, DropdownItem } from '@/components/ui/dropdown';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Textarea } from '@/components/ui/textarea';
import { ApiError } from '@/lib/api';
import { platformApi } from '@/lib/platform-api';

type GlobalOperation =
  | 'grant_all_tenants'
  | 'revert_all_tenants'
  | 'show_all_tenants'
  | 'hide_all_tenants'
  | 'grant_all_apps_all_tenants'
  | 'revert_all_apps_all_tenants'
  | 'show_all_apps_all_tenants'
  | 'hide_all_apps_all_tenants';

type RowOperation = 'grant_all_tenants' | 'revert_all_tenants' | 'show_all_tenants' | 'hide_all_tenants';

interface GlobalApplication {
  key: string;
  group: string;
  maturity: 'built' | 'coming_soon' | 'retired';
  mandatory: boolean;
  access: 'operational' | 'commercial';
  protected_status: 'mandatory' | 'coming_soon' | 'retired' | null;
  global_commercial: { granted: number; inherit: number; denied: number };
  global_operational: { enabled: number; disabled: number; suspended: number };
  can_grant_all_tenants: boolean;
  can_revert_all_tenants: boolean;
  can_show_all_tenants: boolean;
  can_hide_all_tenants: boolean;
}

interface GlobalPreview {
  request_id: string;
  operation: GlobalOperation;
  application_key: string | null;
  layer: 'commercial' | 'operational';
  scope: { mode: 'all' | 'filtered'; total_tenants: number; tenant_ids: string[] | null };
  counts: { eligible_tenants: number; will_apply: number; skipped: number; failed: number };
  skip_reasons: Record<string, number>;
  sample_tenants: Array<{
    tenant_id: string;
    tenant_name: string;
    account_number: number | null;
    outcome: 'applied' | 'skipped' | 'failed';
    skip_reasons: string[];
  }>;
  protections: {
    mandatory: boolean | null;
    dependencies: string[];
    maturity: string | null;
    coming_soon_blocked: boolean;
    retired_blocked: boolean;
  };
}

interface PendingAction {
  operation: GlobalOperation;
  applicationKey: string | null;
}

function catalogKeyLabel(key: string): string {
  return key.replaceAll('.', '_');
}

function protectedTone(status: GlobalApplication['protected_status']): 'warning' | 'negative' | 'muted' | 'neutral' {
  if (status === 'mandatory') return 'warning';
  if (status === 'retired') return 'negative';
  if (status === 'coming_soon') return 'muted';
  return 'neutral';
}

export function GlobalApplicationControlsCard() {
  const t = useTranslations('platform.globalApplicationControls');
  const tApps = useTranslations('applications');
  const [applications, setApplications] = useState<GlobalApplication[]>([]);
  const [tenantCount, setTenantCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [forbidden, setForbidden] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<'all' | 'commercial' | 'built' | 'protected'>('all');
  const [statusFilter, setStatusFilter] = useState<'all' | 'mandatory' | 'coming_soon' | 'retired'>('all');
  const [acting, setActing] = useState(false);
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<GlobalPreview | null>(null);
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    setForbidden(false);
    try {
      const response = await platformApi<{ data: { applications: GlobalApplication[]; tenant_count: number } }>(
        '/platform/application-overrides/global/summary',
      );
      setApplications(response.data.applications);
      setTenantCount(response.data.tenant_count);
    } catch (reason) {
      if (reason instanceof ApiError && reason.status === 403) {
        setForbidden(true);
        return;
      }
      setError(reason instanceof ApiError ? reason.message : t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t]);

  useEffect(() => { load(); }, [load]);

  const filtered = useMemo(() => applications.filter((app) => {
    const label = tApps(`keys.${catalogKeyLabel(app.key)}`);
    const matchesSearch = !search || app.key.includes(search) || label.includes(search);
    const matchesFilter = filter === 'all'
      || (filter === 'commercial' && app.access === 'commercial')
      || (filter === 'built' && app.maturity === 'built' && !app.mandatory)
      || (filter === 'protected' && app.protected_status !== null);
    const matchesStatus = statusFilter === 'all' || app.protected_status === statusFilter;
    return matchesSearch && matchesFilter && matchesStatus;
  }), [applications, filter, search, statusFilter, tApps]);

  async function openPreview(operation: GlobalOperation, applicationKey: string | null) {
    setActing(true);
    setError(null);
    setSuccess(null);
    try {
      const response = await platformApi<{ data: GlobalPreview }>('/platform/application-overrides/global/preview', {
        method: 'POST',
        body: {
          operation,
          application_key: applicationKey,
        },
      });
      setPreview(response.data);
      setPendingAction({ operation, applicationKey });
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
    setSuccess(null);
    try {
      const response = await platformApi<{ data: GlobalPreview }>('/platform/application-overrides/global/apply', {
        method: 'POST',
        body: {
          operation: pendingAction.operation,
          application_key: pendingAction.applicationKey,
          reason: reason || null,
        },
      });
      const result = response.data;
      setPreview(null);
      setPendingAction(null);
      setSuccess(t('applySummary', {
        applied: result.counts.will_apply,
        skipped: result.counts.skipped,
        failed: result.counts.failed,
      }));
      await load();
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : t('applyFailed'));
    } finally {
      setActing(false);
    }
  }

  function renderRowActions(app: GlobalApplication) {
    const actions: Array<{ operation: RowOperation; icon: React.ReactNode; label: string; disabled: boolean }> = [
      { operation: 'grant_all_tenants', icon: <Shield className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />, label: t('grantAll'), disabled: !app.can_grant_all_tenants || acting },
      { operation: 'revert_all_tenants', icon: <Undo2 className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />, label: t('revertAll'), disabled: !app.can_revert_all_tenants || acting },
      { operation: 'show_all_tenants', icon: <Eye className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />, label: t('showAll'), disabled: !app.can_show_all_tenants || acting },
      { operation: 'hide_all_tenants', icon: <EyeOff className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />, label: t('hideAll'), disabled: !app.can_hide_all_tenants || acting },
    ];

    return (
      <>
        <div className="hidden flex-wrap gap-1 md:flex">
          {actions.map((action) => (
            <Button
              key={action.operation}
              variant="ghost"
              size="sm"
              disabled={action.disabled}
              title={action.label}
              onClick={() => openPreview(action.operation, app.key)}
            >
              {action.icon}
            </Button>
          ))}
        </div>
        <div className="md:hidden">
          <Dropdown
            trigger={<MoreHorizontal className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />}
            triggerLabel={t('rowActions')}
            mobilePopover
          >
            {actions.map((action) => (
              <DropdownItem
                key={action.operation}
                disabled={action.disabled}
                onClick={() => openPreview(action.operation, app.key)}
              >
                {action.label}
              </DropdownItem>
            ))}
          </Dropdown>
        </div>
      </>
    );
  }

  if (forbidden) {
    return null;
  }

  return (
    <Card className="mb-6">
      <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <CardTitle className="flex items-center gap-2">
            <Globe className="h-5 w-5 text-primary" strokeWidth={1.7} aria-hidden="true" />
            {t('title')}
          </CardTitle>
          <p className="mt-1 text-sm text-muted">{t('subtitle', { count: tenantCount })}</p>
        </div>
        <Button variant="outline" size="sm" onClick={load} disabled={loading}>
          <RefreshCw className={`h-4 w-4 ${loading ? 'animate-spin' : ''}`} strokeWidth={1.7} aria-hidden="true" />
          {t('refresh')}
        </Button>
      </CardHeader>
      <CardContent className="space-y-4">
        {error && <p className="text-sm text-negative" role="alert">{error}</p>}
        {success && <p className="text-sm text-positive" role="status">{success}</p>}

        <div className="sticky top-0 z-10 -mx-1 flex flex-wrap gap-2 rounded-lg border border-border bg-surface p-2">
          <Button variant="outline" size="sm" disabled={acting} onClick={() => openPreview('grant_all_apps_all_tenants', null)}>{t('allAppsGrant')}</Button>
          <Button variant="outline" size="sm" disabled={acting} onClick={() => openPreview('revert_all_apps_all_tenants', null)}>{t('allAppsRevert')}</Button>
          <Button variant="outline" size="sm" disabled={acting} onClick={() => openPreview('show_all_apps_all_tenants', null)}>{t('allAppsShow')}</Button>
          <Button variant="outline" size="sm" disabled={acting} onClick={() => openPreview('hide_all_apps_all_tenants', null)}>{t('allAppsHide')}</Button>
        </div>

        <div className="flex flex-col gap-3 lg:flex-row lg:items-end lg:justify-between">
          <div className="flex flex-1 flex-col gap-3 sm:flex-row">
            <div className="relative flex-1">
              <Search className="pointer-events-none absolute start-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted" strokeWidth={1.7} aria-hidden="true" />
              <Input value={search} onChange={(e) => setSearch(e.target.value)} placeholder={t('search')} className="ps-9" />
            </div>
            <Select value={filter} onChange={(e) => setFilter(e.target.value as typeof filter)} className="w-full sm:w-40" aria-label={t('filterApps')}>
              <option value="all">{t('filterAll')}</option>
              <option value="commercial">{t('filterCommercial')}</option>
              <option value="built">{t('filterBuilt')}</option>
              <option value="protected">{t('filterProtected')}</option>
            </Select>
            <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value as typeof statusFilter)} className="w-full sm:w-40" aria-label={t('filterStatus')}>
              <option value="all">{t('statusAll')}</option>
              <option value="mandatory">{t('statusMandatory')}</option>
              <option value="coming_soon">{t('statusComingSoon')}</option>
              <option value="retired">{t('statusRetired')}</option>
            </Select>
          </div>
        </div>

        {loading ? (
          <p className="text-sm text-muted">{t('loading')}</p>
        ) : filtered.length === 0 ? (
          <p className="text-sm text-muted">{t('empty')}</p>
        ) : (
          <>
            <div className="hidden overflow-x-auto rounded border border-border md:block">
              <table className="min-w-full text-sm">
                <thead className="bg-surface text-muted">
                  <tr>
                    <th className="px-3 py-2 text-start font-medium">{t('columns.app')}</th>
                    <th className="px-3 py-2 text-start font-medium">{t('columns.globalStatus')}</th>
                    <th className="px-3 py-2 text-start font-medium">{t('columns.protected')}</th>
                    <th className="px-3 py-2 text-start font-medium">{t('columns.actions')}</th>
                  </tr>
                </thead>
                <tbody>
                  {filtered.map((app) => (
                    <tr key={app.key} className="border-t border-border">
                      <td className="px-3 py-2">
                        <div className="font-medium text-text">{tApps(`keys.${catalogKeyLabel(app.key)}`)}</div>
                        <div className="font-mono text-xs text-muted" dir="ltr">{app.key}</div>
                      </td>
                      <td className="px-3 py-2">
                        <div className="flex flex-wrap gap-1">
                          <Badge tone="positive">{t('counts.granted', { count: app.global_commercial.granted })}</Badge>
                          <Badge tone="neutral">{t('counts.enabled', { count: app.global_operational.enabled })}</Badge>
                          <Badge tone="warning">{t('counts.suspended', { count: app.global_operational.suspended })}</Badge>
                        </div>
                      </td>
                      <td className="px-3 py-2">
                        {app.protected_status
                          ? <Badge tone={protectedTone(app.protected_status)}>{t(`protected.${app.protected_status}`)}</Badge>
                          : <span className="text-muted">—</span>}
                      </td>
                      <td className="px-3 py-2">{renderRowActions(app)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <div className="space-y-3 md:hidden">
              {filtered.map((app) => (
                <div key={app.key} className="rounded border border-border bg-surface p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div>
                      <div className="font-medium text-text">{tApps(`keys.${catalogKeyLabel(app.key)}`)}</div>
                      <div className="font-mono text-xs text-muted" dir="ltr">{app.key}</div>
                    </div>
                    {app.protected_status && (
                      <Badge tone={protectedTone(app.protected_status)}>{t(`protected.${app.protected_status}`)}</Badge>
                    )}
                  </div>
                  <div className="mt-2 flex flex-wrap gap-1">
                    <Badge tone="positive">{t('counts.granted', { count: app.global_commercial.granted })}</Badge>
                    <Badge tone="neutral">{t('counts.enabled', { count: app.global_operational.enabled })}</Badge>
                  </div>
                  <div className="mt-3 flex justify-end">{renderRowActions(app)}</div>
                </div>
              ))}
            </div>
          </>
        )}
      </CardContent>

      <Dialog
        open={preview !== null}
        onClose={() => { setPreview(null); setPendingAction(null); }}
        title={t('previewTitle')}
        className="max-w-3xl"
      >
        {preview && (
          <div className="space-y-4 p-4">
            <div className="grid gap-2 text-sm sm:grid-cols-2">
              <p><span className="text-muted">{t('previewOperation')}:</span> {t(`operations.${preview.operation}`)}</p>
              <p><span className="text-muted">{t('previewLayer')}:</span> {t(`layers.${preview.layer}`)}</p>
              <p><span className="text-muted">{t('previewTotal')}:</span> <span className="font-mono">{preview.scope.total_tenants}</span></p>
              <p><span className="text-muted">{t('previewWillApply')}:</span> <span className="font-mono">{preview.counts.will_apply}</span></p>
              <p><span className="text-muted">{t('previewSkipped')}:</span> <span className="font-mono">{preview.counts.skipped}</span></p>
              <p><span className="text-muted">{t('previewFailedCount')}:</span> <span className="font-mono">{preview.counts.failed}</span></p>
            </div>

            {Object.keys(preview.skip_reasons).length > 0 && (
              <div className="rounded border border-border p-3">
                <p className="mb-2 text-sm font-medium text-text">{t('previewSkipReasons')}</p>
                <ul className="space-y-1 text-sm text-muted">
                  {Object.entries(preview.skip_reasons).map(([reasonText, count]) => (
                    <li key={reasonText}><span className="font-mono">{count}</span> · {reasonText}</li>
                  ))}
                </ul>
              </div>
            )}

            {preview.sample_tenants.length > 0 && (
              <div className="max-h-48 overflow-y-auto rounded border border-border">
                <table className="min-w-full text-sm">
                  <thead className="bg-surface text-muted">
                    <tr>
                      <th className="px-3 py-2 text-start">{t('previewTenant')}</th>
                      <th className="px-3 py-2 text-start">{t('previewOutcome')}</th>
                      <th className="px-3 py-2 text-start">{t('previewDetails')}</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.sample_tenants.map((row) => (
                      <tr key={`${row.tenant_id}-${row.outcome}`} className="border-t border-border">
                        <td className="px-3 py-2">
                          <div>{row.tenant_name}</div>
                          <div className="font-mono text-xs text-muted" dir="ltr">{row.account_number ?? row.tenant_id}</div>
                        </td>
                        <td className="px-3 py-2">
                          <Badge tone={row.outcome === 'applied' ? 'positive' : row.outcome === 'failed' ? 'negative' : 'muted'}>
                            {t(`outcomes.${row.outcome}`)}
                          </Badge>
                        </td>
                        <td className="px-3 py-2 text-muted">{row.skip_reasons.join(' · ') || '—'}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            <div>
              <Label htmlFor="global-override-reason">{t('reasonLabel')}</Label>
              <Textarea id="global-override-reason" value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className="mt-1.5" />
            </div>
            <div className="flex justify-end gap-2">
              <Button variant="outline" onClick={() => { setPreview(null); setPendingAction(null); }}>{t('cancel')}</Button>
              <Button
                onClick={applyPending}
                disabled={acting || preview.counts.will_apply === 0}
              >
                {acting ? t('applying') : t('confirmApply', { count: preview.counts.will_apply })}
              </Button>
            </div>
          </div>
        )}
      </Dialog>
    </Card>
  );
}
