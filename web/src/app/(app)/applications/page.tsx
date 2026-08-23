'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Boxes, CircleAlert, Clock3, LayoutGrid, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Tabs, type TabDef } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { currentUser } from '@/lib/auth';
import { api, ApiError } from '@/lib/api';

type CommercialAvailability = 'included' | 'addon' | 'trial' | 'not_available';
type EffectiveAccess = 'full' | 'read_only' | 'denied';

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

type DialogMode = 'enable' | 'disable';

const commercialTone: Record<CommercialAvailability, 'positive' | 'neutral' | 'warning' | 'muted'> = {
  included: 'positive',
  addon: 'neutral',
  trial: 'warning',
  not_available: 'muted',
};

const accessTone: Record<EffectiveAccess, 'positive' | 'warning' | 'negative'> = {
  full: 'positive',
  read_only: 'warning',
  denied: 'negative',
};

export default function ApplicationsPage() {
  const t = useTranslations('applications');
  const tc = useTranslations('common');
  const { success, error: toastError } = useToast();
  const user = currentUser();
  const canManage = user?.role === 'owner' || user?.role === 'admin';

  const groupLabels = t.raw('groups') as Record<string, string>;
  const keyLabels = t.raw('keys') as Record<string, string>;
  const labelFor = (key: string) => keyLabels[key.replace(/\./g, '_')] ?? key;

  const [apps, setApps] = useState<ApplicationEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [groupFilter, setGroupFilter] = useState('all');
  const [dialog, setDialog] = useState<{ app: ApplicationEntry; mode: DialogMode } | null>(null);
  const [reason, setReason] = useState('');
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    api<{ data: Record<string, Omit<ApplicationEntry, 'key'>> }>('/applications')
      .then((res) => setApps(Object.entries(res.data).map(([key, app]) => ({ key, ...app }))))
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : t('loadFailed')))
      .finally(() => setLoading(false));
  }, [t]);

  useEffect(() => {
    if (canManage) load();
    else setLoading(false);
  }, [canManage, load]);

  const tabs: TabDef[] = useMemo(() => {
    const counts = new Map<string, number>();
    for (const app of apps) counts.set(app.group, (counts.get(app.group) ?? 0) + 1);
    return [
      { id: 'all', label: t('allTab'), count: apps.length },
      ...Array.from(counts.entries()).map(([group, count]) => ({ id: group, label: groupLabels[group] ?? group, count })),
    ];
  }, [apps, groupLabels, t]);

  const visible = groupFilter === 'all' ? apps : apps.filter((app) => app.group === groupFilter);

  function commercialFor(app: ApplicationEntry): CommercialAvailability {
    if (app.maturity !== 'built') return 'not_available';
    return app.commercial?.availability ?? 'not_available';
  }

  function accessFor(app: ApplicationEntry): EffectiveAccess {
    return app.effective_access ?? 'denied';
  }

  function dependencyFor(app: ApplicationEntry): 'satisfied' | 'missing' | 'not_applicable' {
    if (app.dependencies.length === 0) return 'not_applicable';
    return app.dependency_status ?? 'missing';
  }

  function openDialog(app: ApplicationEntry, mode: DialogMode) {
    setDialog({ app, mode });
    setReason('');
    setDialogError(null);
  }

  async function confirmAction() {
    if (!dialog) return;
    setActing(true);
    setDialogError(null);
    const name = labelFor(dialog.app.key);
    try {
      await api(`/applications/${dialog.mode}`, {
        method: 'POST',
        body: { application_key: dialog.app.key, reason: reason.trim() || undefined },
      });
      success(t(dialog.mode === 'enable' ? 'enabledToast' : 'disabledToast', { name }));
      setDialog(null);
      load();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('saveFailed');
      setDialogError(message);
      toastError(message);
    } finally {
      setActing(false);
    }
  }

  function commercialBadge(app: ApplicationEntry) {
    const commercial = commercialFor(app);
    return <Badge tone={commercialTone[commercial]}>{t(`commercial.${commercial}`)}</Badge>;
  }

  function commercialDetail(app: ApplicationEntry) {
    const commercial = app.commercial;
    if (!commercial) return null;
    const date = (value: string) => new Intl.DateTimeFormat(undefined, { dateStyle: 'medium' }).format(new Date(value));
    if (commercial.trial_until) return <p className="mt-1 text-xs text-muted">{t('commercialDetails.trialUntil', { date: date(commercial.trial_until) })}</p>;
    if (commercial.cancels_at) return <p className="mt-1 text-xs text-muted">{t('commercialDetails.cancelsAt', { date: date(commercial.cancels_at) })}</p>;
    if (commercial.expired) return <p className="mt-1 text-xs text-muted">{t('commercialDetails.expired')}</p>;
    return null;
  }

  function accessBadge(app: ApplicationEntry) {
    const access = accessFor(app);
    return <Badge tone={accessTone[access]}>{t(`access.${access}`)}</Badge>;
  }

  function operationalBadge(app: ApplicationEntry) {
    if (app.mandatory) return <Badge tone="neutral">{t('mandatoryBadge')}</Badge>;
    if (app.maturity !== 'built') return <Badge tone="muted">{t('comingSoonBadge')}</Badge>;
    if (app.status === 'suspended') return <Badge tone="warning">{t('suspendedBadge')}</Badge>;
    return <Badge tone={app.enabled ? 'positive' : 'muted'}>{app.enabled ? t('enabledBadge') : t('disabledBadge')}</Badge>;
  }

  function dependencyBadge(app: ApplicationEntry) {
    const dependency = dependencyFor(app);
    if (dependency === 'not_applicable') return <span className="text-xs text-muted">{t('dependencies.notApplicable')}</span>;
    return <Badge tone={dependency === 'satisfied' ? 'positive' : 'warning'}>{t(`dependencies.${dependency}`)}</Badge>;
  }

  function actionsCell(app: ApplicationEntry) {
    const commercial = commercialFor(app);
    const access = accessFor(app);
    if (app.mandatory || app.maturity !== 'built') return <span className="text-xs text-muted">{t('actions.unavailable')}</span>;
    if (commercial === 'included' && app.status === 'disabled') return <Button size="sm" variant="outline" onClick={() => openDialog(app, 'enable')}>{t('enable')}</Button>;
    if (access === 'read_only') return <Button size="sm" variant="outline" disabled>{t('actions.viewHistory')}</Button>;
    if (commercial === 'addon') return <Button size="sm" variant="outline" disabled>{t('actions.addToPlan')}</Button>;
    if (commercial === 'trial') return <Button size="sm" variant="outline" disabled>{t('actions.startTrial')}</Button>;
    return app.enabled
      ? <Button size="sm" variant="outline" onClick={() => openDialog(app, 'disable')}>{t('disable')}</Button>
      : <Button size="sm" variant="outline" onClick={() => openDialog(app, 'enable')}>{t('enable')}</Button>;
  }

  if (!canManage) {
    return (
      <div className="space-y-5">
        <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
        <Card><CardContent className="flex items-center gap-3 py-8 text-sm text-muted"><ShieldCheck className="h-5 w-5 shrink-0" strokeWidth={1.7} />{t('noAccess')}</CardContent></Card>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
        <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted">{t('subtitle')}</p>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <div className="rounded-md bg-primary/10 p-2 text-primary"><Boxes className="h-5 w-5" strokeWidth={1.7} /></div>
            <div><CardTitle>{t('experienceTitle')}</CardTitle><p className="mt-1 text-sm text-muted">{t('experienceSubtitle')}</p></div>
          </div>
        </CardHeader>
        <Tabs tabs={tabs} value={groupFilter} onChange={setGroupFilter} />
        <CardContent>
          {loading ? (
            <div className="space-y-2" aria-label={tc('loading')}>{[0, 1, 2, 3].map((item) => <div key={item} className="h-12 animate-pulse rounded-md bg-muted" />)}</div>
          ) : loadError ? (
            <p role="alert" className="rounded-md bg-negative/10 px-3 py-2 text-sm text-negative">{loadError}</p>
          ) : visible.length === 0 ? (
            <div className="rounded-md border border-dashed border-border px-4 py-12 text-center"><LayoutGrid className="mx-auto h-7 w-7 text-muted" strokeWidth={1.6} /><p className="mt-3 font-medium text-text">{t('emptyTitle')}</p></div>
          ) : (
            <>
              <div className="hidden overflow-x-auto lg:block">
                <table className="w-full min-w-[68rem] text-sm">
                  <thead className="border-b border-border text-start text-muted"><tr>
                    <th className="px-3 py-3 font-medium">{t('columns.name')}</th><th className="px-3 py-3 font-medium">{t('columns.group')}</th><th className="px-3 py-3 font-medium">{t('columns.commercial')}</th><th className="px-3 py-3 font-medium">{t('columns.access')}</th><th className="px-3 py-3 font-medium">{t('columns.operational')}</th><th className="px-3 py-3 font-medium">{t('columns.dependencies')}</th><th className="px-3 py-3 text-end font-medium">{t('columns.actions')}</th>
                  </tr></thead>
                  <tbody>{visible.map((app) => <tr key={app.key} className={`border-b border-border/70 last:border-0 ${app.maturity !== 'built' ? 'opacity-70' : ''}`}>
                    <td className="px-3 py-3 font-medium text-text">{labelFor(app.key)}</td><td className="px-3 py-3 text-muted">{groupLabels[app.group] ?? app.group}</td><td className="px-3 py-3">{commercialBadge(app)}{commercialDetail(app)}</td><td className="px-3 py-3">{accessBadge(app)}</td><td className="px-3 py-3">{operationalBadge(app)}</td><td className="px-3 py-3">{dependencyBadge(app)}</td><td className="px-3 py-3 text-end">{actionsCell(app)}</td>
                  </tr>)}</tbody>
                </table>
              </div>
              <div className="space-y-3 lg:hidden">{visible.map((app) => <article key={app.key} className={`rounded-md border border-border p-3 ${app.maturity !== 'built' ? 'opacity-70' : ''}`}>
                <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="font-medium text-text">{labelFor(app.key)}</h2><p className="mt-1 text-sm text-muted">{groupLabels[app.group] ?? app.group}</p></div>{operationalBadge(app)}</div>
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-3 border-t border-border pt-3 text-xs"><div><dt className="text-muted">{t('columns.commercial')}</dt><dd className="mt-1">{commercialBadge(app)}{commercialDetail(app)}</dd></div><div><dt className="text-muted">{t('columns.access')}</dt><dd className="mt-1">{accessBadge(app)}</dd></div><div><dt className="text-muted">{t('columns.dependencies')}</dt><dd className="mt-1">{dependencyBadge(app)}</dd></div><div><dt className="text-muted">{t('columns.operational')}</dt><dd className="mt-1">{operationalBadge(app)}</dd></div></dl>
                <div className="mt-3 border-t border-border pt-3">{actionsCell(app)}</div>
              </article>)}</div>
            </>
          )}
          <div role="status" aria-atomic="true" className="mt-4 flex items-center gap-2 text-xs text-muted"><CircleAlert className="h-4 w-4 shrink-0" strokeWidth={1.6} />{t('securityNotice')}</div>
        </CardContent>
      </Card>

      <Dialog open={dialog !== null} onClose={() => setDialog(null)} title={dialog ? t(dialog.mode === 'enable' ? 'enableTitle' : 'disableTitle', { name: labelFor(dialog.app.key) }) : ''}>
        {dialog && <div className="space-y-4"><div className="space-y-1.5"><Label htmlFor="application-reason">{t('reasonLabel')}</Label><Textarea id="application-reason" value={reason} onChange={(event) => setReason(event.target.value)} /></div>{dialogError && <p role="alert" className="rounded-md bg-negative/10 px-3 py-2 text-xs text-negative">{dialogError}</p>}<div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setDialog(null)}>{tc('cancel')}</Button><Button disabled={acting} onClick={confirmAction}>{acting ? <><Clock3 className="me-2 h-4 w-4 animate-spin" />{tc('loading')}</> : t(dialog.mode === 'enable' ? 'enable' : 'disable')}</Button></div></div>}
      </Dialog>
    </div>
  );
}
