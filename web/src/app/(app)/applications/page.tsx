'use client';

import * as React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { CircleAlert, Clock3, LayoutGrid, LockKeyhole, ShieldCheck } from 'lucide-react';
import { SearchBar } from '@/components/data-explorer/search-bar';
import { EmptyState, ErrorState, LoadingState, PageHeader, type PageAction } from '@/components/nebrax';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { currentUser } from '@/lib/auth';
import { api, ApiError } from '@/lib/api';
import { resolveApplicationManagementAction } from '@/lib/application-management-actions';

type CommercialAvailability = 'included' | 'addon' | 'trial' | 'not_available';
type EffectiveAccess = 'full' | 'read_only' | 'denied';
type DialogMode = 'enable' | 'disable';
type StatusFilter = 'all' | 'enabled' | 'disabled' | 'coming_soon';
type ManagementAction = ReturnType<typeof resolveApplicationManagementAction>;

interface ApplicationEntry {
  key: string;
  group: string;
  maturity: 'built' | 'coming_soon' | 'retired';
  mandatory: boolean;
  dependencies: string[];
  enabled: boolean;
  status: 'enabled' | 'disabled' | 'suspended';
  changed_by: string | null;
  changed_at: string | null;
  reason: string | null;
  commercial?: {
    availability: CommercialAvailability;
    source_count: number;
    trial_until?: string | null;
    cancels_at?: string | null;
    expired?: boolean;
  };
  effective_access?: EffectiveAccess;
  dependency_status?: 'satisfied' | 'missing' | 'not_applicable';
}

type ActionDialog = { mode: DialogMode; apps: ApplicationEntry[]; label: string } | null;

/**
 * يقرأ حمولة `/applications` **بعد التحقق من شكلها**.
 *
 * العقد هو خريطة مفاتيح: `{ data: { "sales.pos": {...} } }`. أي شكل آخر — مصفوفة،
 * أو `null`، أو حمولة من طبقةٍ لا تعرف هذا المسار — ليس «صفر تطبيقات» بل تعذّرُ
 * قراءة. إعادته كـ `null` هنا هي ما يمنع تحوّل الفشل إلى حالة فراغ مضلّلة.
 */
function readApplications(payload: unknown): ApplicationEntry[] | null {
  const data = (payload as { data?: unknown } | null)?.data;
  if (data === null || typeof data !== 'object' || Array.isArray(data)) return null;

  return Object.entries(data as Record<string, Omit<ApplicationEntry, 'key'>>)
    .map(([key, app]) => ({ key, ...app }));
}

const commercialTone: Record<CommercialAvailability, 'positive' | 'neutral' | 'warning' | 'muted'> = {
  included: 'positive',
  addon: 'neutral',
  trial: 'warning',
  not_available: 'muted',
};

export default function ApplicationsPage() {
  const t = useTranslations('applications');
  const tc = useTranslations('common');
  const { success, error: toastError } = useToast();
  const user = currentUser();
  const canManage = user?.role === 'owner' || user?.role === 'admin';
  const groupLabels = t.raw('groups') as Record<string, string>;
  const keyLabels = t.raw('keys') as Record<string, string>;
  const labelFor = useCallback((key: string) => keyLabels[key.replace(/\./g, '_')] ?? key, [keyLabels]);

  const [apps, setApps] = useState<ApplicationEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('all');
  const [groupFilter, setGroupFilter] = useState('all');
  const [query, setQuery] = useState('');
  const [dialog, setDialog] = useState<ActionDialog>(null);
  const [reason, setReason] = useState('');
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    api<unknown>('/applications')
      .then((res) => {
        const parsed = readApplications(res);
        if (parsed === null) {
          setLoadError(t('loadFailed'));
          return;
        }
        setApps(parsed);
      })
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : t('loadFailed')))
      .finally(() => setLoading(false));
  }, [t]);

  useEffect(() => {
    if (canManage) load();
    else setLoading(false);
  }, [canManage, load]);

  function accessFor(app: ApplicationEntry): EffectiveAccess {
    return app.effective_access ?? 'denied';
  }

  function dependencyFor(app: ApplicationEntry): 'satisfied' | 'missing' | 'not_applicable' {
    if (app.dependencies.length === 0) return 'not_applicable';
    return app.dependency_status ?? 'missing';
  }

  function actionFor(app: ApplicationEntry): ManagementAction {
    return resolveApplicationManagementAction({
      maturity: app.maturity,
      mandatory: app.mandatory,
      effectiveAccess: accessFor(app),
      status: app.status,
      dependencyStatus: dependencyFor(app),
    });
  }

  const counts = useMemo(() => ({
    total: apps.length,
    enabled: apps.filter((app) => app.maturity === 'built' && app.status === 'enabled').length,
    disabled: apps.filter((app) => app.maturity === 'built' && app.status !== 'enabled').length,
    comingSoon: apps.filter((app) => app.maturity === 'coming_soon').length,
  }), [apps]);

  const groups = useMemo(() => {
    const result = new Map<string, ApplicationEntry[]>();
    const normalizedQuery = query.trim().toLocaleLowerCase();
    for (const app of apps) {
      if (groupFilter !== 'all' && app.group !== groupFilter) continue;
      if (statusFilter === 'enabled' && !(app.maturity === 'built' && app.status === 'enabled')) continue;
      if (statusFilter === 'disabled' && !(app.maturity === 'built' && app.status !== 'enabled')) continue;
      if (statusFilter === 'coming_soon' && app.maturity !== 'coming_soon') continue;
      const groupLabel = groupLabels[app.group] ?? app.group;
      if (normalizedQuery && !`${labelFor(app.key)} ${groupLabel} ${app.key}`.toLocaleLowerCase().includes(normalizedQuery)) continue;
      const group = result.get(app.group) ?? [];
      group.push(app);
      result.set(app.group, group);
    }
    return Array.from(result.entries());
  }, [apps, groupFilter, groupLabels, labelFor, query, statusFilter]);

  const availableGroups = useMemo(() => Array.from(new Set(apps.map((app) => app.group))), [apps]);

  function openAction(appsToChange: ApplicationEntry[], mode: DialogMode, label: string) {
    const eligible = appsToChange.filter((app) => actionFor(app).kind === mode);
    if (eligible.length === 0) return;
    setDialog({ mode, apps: eligible, label });
    setReason('');
    setDialogError(null);
  }

  async function confirmAction() {
    if (!dialog) return;
    setActing(true);
    setDialogError(null);
    try {
      for (const app of dialog.apps) {
        await api(`/applications/${dialog.mode}`, {
          method: 'POST',
          body: { application_key: app.key, reason: reason.trim() || undefined },
        });
      }
      success(t(dialog.mode === 'enable' ? 'enabledToast' : 'disabledToast', { name: dialog.label }));
      setDialog(null);
      load();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('saveFailed');
      setDialogError(message);
      toastError(message);
      load();
    } finally {
      setActing(false);
    }
  }

  function operationalBadge(app: ApplicationEntry) {
    if (app.mandatory) return <Badge tone="neutral">{t('mandatoryBadge')}</Badge>;
    if (app.maturity !== 'built') return <Badge tone="muted">{t('comingSoonBadge')}</Badge>;
    if (app.status === 'suspended') return <Badge tone="warning">{t('suspendedBadge')}</Badge>;
    return <Badge tone={app.status === 'enabled' ? 'positive' : 'muted'}>{app.status === 'enabled' ? t('enabledBadge') : t('disabledBadge')}</Badge>;
  }

  function commercialBadge(app: ApplicationEntry) {
    if (app.maturity !== 'built') return null;
    const availability = app.commercial?.availability ?? 'not_available';
    if (availability === 'included') return null;
    return <Badge tone={commercialTone[availability]}>{t(`commercial.${availability}`)}</Badge>;
  }

  function ApplicationSwitch({ app }: { app: ApplicationEntry }) {
    const action = actionFor(app);
    const mode: DialogMode = action.kind === 'disable' ? 'disable' : 'enable';
    const canToggle = action.kind === 'enable' || action.kind === 'disable';

    if (app.mandatory) {
      return <div className="flex min-h-11 items-center gap-2 text-xs text-muted"><LockKeyhole className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" /><span>{t('mandatoryBadge')}</span></div>;
    }
    if (app.maturity !== 'built' || action.kind === 'unavailable') return <span className="text-xs text-muted">{t('actions.unavailable')}</span>;

    return (
      <button
        type="button"
        role="switch"
        aria-checked={app.status === 'enabled'}
        aria-label={`${mode === 'disable' ? t('disable') : t('enable')} ${labelFor(app.key)}`}
        disabled={!canToggle}
        onClick={() => openAction([app], mode, labelFor(app.key))}
        className={`inline-flex h-7 w-12 items-center rounded-full border p-0.5 transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50 ${app.status === 'enabled' ? 'justify-end border-primary bg-primary' : 'justify-start border-border bg-background'}`}
      >
        <span className="block h-5 w-5 rounded-full border border-border bg-surface" aria-hidden="true" />
      </button>
    );
  }

  const allEnableCandidates = apps.filter((app) => actionFor(app).kind === 'enable');
  const allDisableCandidates = apps.filter((app) => actionFor(app).kind === 'disable');
  const statusTabs: { id: StatusFilter; label: string; count: number }[] = [
    { id: 'all', label: t('allTab'), count: counts.total },
    { id: 'enabled', label: t('enabledBadge'), count: counts.enabled },
    { id: 'disabled', label: t('disabledBadge'), count: counts.disabled },
    { id: 'coming_soon', label: t('comingSoonBadge'), count: counts.comingSoon },
  ];

  const headerActions: PageAction[] = [
    {
      key: 'enable-all',
      label: t('enable'),
      hint: `(${allEnableCandidates.length})`,
      variant: 'outline',
      emphasis: 'secondary',
      disabled: allEnableCandidates.length === 0 || loading,
      onClick: () => openAction(apps, 'enable', t('experienceTitle')),
    },
    {
      key: 'disable-all',
      label: t('disable'),
      hint: `(${allDisableCandidates.length})`,
      variant: 'outline',
      emphasis: 'secondary',
      disabled: allDisableCandidates.length === 0 || loading,
      onClick: () => openAction(apps, 'disable', t('experienceTitle')),
    },
  ];

  if (!canManage) {
    return (
      <div className="space-y-5">
        <PageHeader title={t('title')} />
        <Card>
          <CardContent className="flex items-center gap-3 py-8 text-sm text-muted">
            <ShieldCheck className="h-5 w-5 shrink-0" strokeWidth={1.7} />
            {t('noAccess')}
          </CardContent>
        </Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <PageHeader title={t('title')} description={t('subtitle')} actions={headerActions} />

      <section aria-label={t('allTab')} className="space-y-4 rounded border border-border bg-surface p-3 sm:p-4">
        <div className="grid grid-cols-2 gap-2 text-sm sm:grid-cols-4 sm:gap-3">
          {statusTabs.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={() => setStatusFilter(item.id)}
              aria-pressed={statusFilter === item.id}
              className={`rounded border px-3 py-2.5 text-start transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${statusFilter === item.id ? 'border-primary bg-primary-soft' : 'border-border bg-surface hover:bg-background'}`}
            >
              <span className="block truncate text-xs text-muted">{item.label}</span>
              <span className="num mt-1 block text-lg font-semibold text-text">{item.count}</span>
            </button>
          ))}
        </div>

        <div className="flex flex-col gap-3 border-t border-border pt-4 lg:flex-row lg:items-center">
          <SearchBar
            value={query}
            onChange={setQuery}
            placeholder={t('columns.name')}
            ariaLabel={t('columns.name')}
            className="min-w-0 lg:flex-1"
          />
          <div className="-mx-1 flex max-w-full gap-2 overflow-x-auto px-1 pb-1 lg:mx-0 lg:max-w-[55%] lg:px-0">
            <Button size="sm" variant={groupFilter === 'all' ? 'primary' : 'outline'} onClick={() => setGroupFilter('all')}>{t('allTab')}</Button>
            {availableGroups.map((group) => (
              <Button key={group} size="sm" variant={groupFilter === group ? 'primary' : 'outline'} onClick={() => setGroupFilter(group)}>
                {groupLabels[group] ?? group}
              </Button>
            ))}
          </div>
        </div>
      </section>

      {loading ? (
        <LoadingState variant="cards" rows={3} label={tc('loading')} />
      ) : loadError ? (
        <ErrorState message={loadError} onRetry={load} retryLabel={tc('retry')} />
      ) : groups.length === 0 ? (
        <EmptyState icon={LayoutGrid} title={t('emptyTitle')} />
      ) : (
        <div className="space-y-4">
          {groups.map(([group, groupApps]) => {
            const groupEnabled = groupApps.filter((app) => app.maturity === 'built' && app.status === 'enabled').length;
            const groupEnableCandidates = groupApps.filter((app) => actionFor(app).kind === 'enable');
            const groupDisableCandidates = groupApps.filter((app) => actionFor(app).kind === 'disable');
            const groupLabel = groupLabels[group] ?? group;
            return (
              <section key={group} className="overflow-hidden rounded border border-border bg-surface">
                <div className="flex flex-col gap-3 border-b border-border bg-background/60 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h2 className="font-semibold text-text">{groupLabel}</h2>
                    <p className="mt-0.5 text-xs text-muted">
                      <span className="num">{groupEnabled}</span> / <span className="num">{groupApps.length}</span> {t('enabledBadge')}
                    </p>
                  </div>
                  <div className="flex gap-2">
                    <Button size="sm" variant="outline" className="flex-1 sm:flex-none" disabled={groupEnableCandidates.length === 0} onClick={() => openAction(groupApps, 'enable', groupLabel)}>{t('enable')}</Button>
                    <Button size="sm" variant="outline" className="flex-1 sm:flex-none" disabled={groupDisableCandidates.length === 0} onClick={() => openAction(groupApps, 'disable', groupLabel)}>{t('disable')}</Button>
                  </div>
                </div>
                <div className="divide-y divide-border">
                  {groupApps.map((app) => {
                    const action = actionFor(app);
                    return (
                      <article key={app.key} className={`flex items-start justify-between gap-3 px-4 py-3 sm:min-h-[72px] sm:items-center sm:gap-4 ${app.maturity !== 'built' ? 'opacity-70' : ''}`}>
                        <div className="min-w-0 flex-1">
                          <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
                            <h3 className="font-medium text-text">{labelFor(app.key)}</h3>
                            {operationalBadge(app)}
                            {commercialBadge(app)}
                          </div>
                          <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs leading-relaxed text-muted">
                            {app.dependencies.length > 0 && <span>{t('columns.dependencies')}: {app.dependencies.map(labelFor).join('، ')}</span>}
                            {app.reason && app.status === 'suspended' && <span>{app.reason}</span>}
                            {action.kind === 'blocked' && <span>{t(`actions.blocked.${action.reason}`)}</span>}
                          </div>
                        </div>
                        <div className="shrink-0 pt-0.5 sm:pt-0"><ApplicationSwitch app={app} /></div>
                      </article>
                    );
                  })}
                </div>
              </section>
            );
          })}
        </div>
      )}

      <div role="status" aria-atomic="true" className="flex items-start gap-2 text-xs leading-relaxed text-muted"><CircleAlert className="mt-0.5 h-4 w-4 shrink-0" strokeWidth={1.6} />{t('securityNotice')}</div>

      <Dialog open={dialog !== null} onClose={() => !acting && setDialog(null)} title={dialog ? t(dialog.mode === 'enable' ? 'enableTitle' : 'disableTitle', { name: dialog.label }) : ''}>
        {dialog && <div className="space-y-4">
          {dialog.apps.length > 1 && <p className="rounded border border-border bg-background px-3 py-2 text-sm text-muted"><span className="num font-semibold text-text">{dialog.apps.length}</span> {t('experienceTitle')}</p>}
          <div className="space-y-1.5"><Label htmlFor="application-reason">{t('reasonLabel')}</Label><Textarea id="application-reason" value={reason} onChange={(event) => setReason(event.target.value)} /></div>
          {dialogError && <p role="alert" className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{dialogError}</p>}
          <div className="flex justify-end gap-2"><Button variant="outline" disabled={acting} onClick={() => setDialog(null)}>{tc('cancel')}</Button><Button disabled={acting} onClick={confirmAction}>{acting ? <><Clock3 className="me-2 h-4 w-4 animate-spin" />{tc('loading')}</> : t(dialog.mode === 'enable' ? 'enable' : 'disable')}</Button></div>
        </div>}
      </Dialog>
    </div>
  );
}
