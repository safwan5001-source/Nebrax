'use client';
import { DISPLAY_LOCALE } from '@/lib/formatting';

import * as React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Boxes, CircleAlert, Clock3, LayoutGrid, ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Label } from '@/components/ui/label';
import { Switch } from '@/components/ui/switch';
import { Tabs, type TabDef } from '@/components/ui/tabs';
import { Textarea } from '@/components/ui/textarea';
import { useToast } from '@/components/ui/toast';
import { currentUser } from '@/lib/auth';
import { api, ApiError } from '@/lib/api';
import { resolveApplicationManagementAction } from '@/lib/application-management-actions';

type CommercialAvailability = 'included' | 'addon' | 'trial' | 'not_available';
type EffectiveAccess = 'full' | 'read_only' | 'denied';
type DialogMode = 'enable' | 'disable';
type ControlScope = 'capability' | 'group' | 'group_capabilities' | 'all_groups';

interface ApplicationEntry {
  key: string;
  group: string;
  maturity: 'built' | 'coming_soon' | 'retired';
  mandatory: boolean;
  dependencies: string[];
  enabled: boolean;
  group_enabled?: boolean;
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

interface ApplicationGroupState {
  key: string;
  enabled: boolean;
  manageable: boolean;
  changed_by: string | null;
  changed_at: string | null;
  reason: string | null;
  capabilities: string[];
}

type DialogTarget =
  | { scope: 'capability'; mode: DialogMode; app: ApplicationEntry }
  | { scope: 'group' | 'group_capabilities'; mode: DialogMode; group: ApplicationGroupState }
  | { scope: 'all_groups'; mode: DialogMode };

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
  const locale = useLocale();
  const { success, error: toastError } = useToast();
  const user = currentUser();
  const canManage = user?.role === 'owner' || user?.role === 'admin';
  const isArabic = locale.toLowerCase().startsWith('ar');

  const controls = isArabic
    ? {
        enable: 'تفعيل',
        disable: 'تعطيل',
        enableAll: 'تفعيل الكل',
        disableAll: 'تعطيل الكل',
        enabled: 'مفعّل',
        disabled: 'معطّل',
        principalTitle: 'التحكم في التطبيقات',
        principalDescription: 'تعطيل التطبيق الرئيسي يحجب التطبيق وفروعه دون حذف البيانات أو تغيير حالات الفروع المحفوظة.',
        globalDescription: 'تحكم جماعي في جميع التطبيقات الرئيسية.',
        childrenDescription: 'تحكم جماعي في فروع هذا التطبيق.',
        updated: 'تم تحديث إعدادات التطبيقات.',
        groupDisableTitle: 'تعطيل التطبيق الرئيسي؟',
        groupDisableBody: 'سيتم حجب التطبيق وفروعه عن المستخدمين. لن تُحذف أي بيانات، وستبقى حالات الفروع محفوظة لإعادتها عند تفعيل التطبيق لاحقًا.',
        childrenDisableTitle: 'تعطيل جميع فروع التطبيق؟',
        childrenDisableBody: 'سيتم تعطيل الفروع القابلة للتعطيل وفق الاعتماديات والبيانات التشغيلية. لن تُحذف أي بيانات.',
        globalDisableTitle: 'تعطيل جميع التطبيقات؟',
        globalDisableBody: 'سيتم حجب جميع التطبيقات الرئيسية دفعة واحدة مع حفظ حالات الفروع والبيانات كما هي.',
        confirmEnable: 'تأكيد التفعيل',
        confirmDisable: 'تأكيد التعطيل',
      }
    : {
        enable: 'Enable',
        disable: 'Disable',
        enableAll: 'Enable all',
        disableAll: 'Disable all',
        enabled: 'Enabled',
        disabled: 'Disabled',
        principalTitle: 'Application controls',
        principalDescription: 'Disabling a principal application hides it and its branches without deleting data or changing saved branch states.',
        globalDescription: 'Bulk control for all principal applications.',
        childrenDescription: 'Bulk control for this application’s branches.',
        updated: 'Application settings updated.',
        groupDisableTitle: 'Disable this application?',
        groupDisableBody: 'The application and its branches will be hidden. No data will be deleted, and saved branch states will be restored when re-enabled.',
        childrenDisableTitle: 'Disable all application branches?',
        childrenDisableBody: 'Eligible branches will be disabled according to dependencies and operational-data safeguards. No data will be deleted.',
        globalDisableTitle: 'Disable all applications?',
        globalDisableBody: 'All principal applications will be hidden while branch states and data remain unchanged.',
        confirmEnable: 'Confirm enable',
        confirmDisable: 'Confirm disable',
      };

  const groupLabels = t.raw('groups') as Record<string, string>;
  const keyLabels = t.raw('keys') as Record<string, string>;
  const labelFor = (key: string) => keyLabels[key.replace(/\./g, '_')] ?? key;

  const [apps, setApps] = useState<ApplicationEntry[]>([]);
  const [groups, setGroups] = useState<ApplicationGroupState[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [groupFilter, setGroupFilter] = useState('all');
  const [dialog, setDialog] = useState<DialogTarget | null>(null);
  const [reason, setReason] = useState('');
  const [dialogError, setDialogError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [quickAction, setQuickAction] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    api<{
      data: Record<string, Omit<ApplicationEntry, 'key'>>;
      groups: Record<string, ApplicationGroupState>;
    }>('/applications')
      .then((res) => {
        setApps(Object.entries(res.data).map(([key, app]) => ({ key, ...app })));
        setGroups(Object.values(res.groups ?? {}));
      })
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
  const visibleGroups = groupFilter === 'all' ? groups : groups.filter((group) => group.key === groupFilter);

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

  function openDialog(target: DialogTarget) {
    setDialog(target);
    setReason('');
    setDialogError(null);
  }

  function bodyFor(target: DialogTarget): Record<string, string | undefined> {
    if (target.scope === 'capability') {
      return { scope: 'capability', application_key: target.app.key, reason: reason.trim() || undefined };
    }
    if (target.scope === 'all_groups') {
      return { scope: 'all_groups', reason: reason.trim() || undefined };
    }
    return { scope: target.scope, group_key: target.group.key, reason: reason.trim() || undefined };
  }

  async function runAction(target: DialogTarget, withDialog = true) {
    const token = target.scope === 'capability'
      ? target.app.key
      : target.scope === 'all_groups'
        ? 'all_groups'
        : `${target.scope}:${target.group.key}`;

    if (withDialog) {
      setActing(true);
      setDialogError(null);
    } else {
      setQuickAction(token);
    }

    try {
      await api(`/applications/${target.mode}`, {
        method: 'POST',
        body: bodyFor(target),
      });

      if (target.scope === 'capability') {
        const name = labelFor(target.app.key);
        success(t(target.mode === 'enable' ? 'enabledToast' : 'disabledToast', { name }));
      } else {
        success(controls.updated);
      }

      if (withDialog) setDialog(null);
      load();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : t('saveFailed');
      if (withDialog) setDialogError(message);
      toastError(message);
    } finally {
      if (withDialog) setActing(false);
      else setQuickAction(null);
    }
  }

  async function confirmAction() {
    if (!dialog) return;
    await runAction(dialog, true);
  }

  function toggleGroup(group: ApplicationGroupState, checked: boolean) {
    const target: DialogTarget = { scope: 'group', mode: checked ? 'enable' : 'disable', group };
    if (checked) void runAction(target, false);
    else openDialog(target);
  }

  function commercialBadge(app: ApplicationEntry) {
    const commercial = commercialFor(app);
    return <Badge tone={commercialTone[commercial]}>{t(`commercial.${commercial}`)}</Badge>;
  }

  function commercialDetail(app: ApplicationEntry) {
    const commercial = app.commercial;
    if (!commercial) return null;
    const date = (value: string) => new Intl.DateTimeFormat(DISPLAY_LOCALE, { dateStyle: 'medium' }).format(new Date(value));
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
    const action = resolveApplicationManagementAction({
      maturity: app.maturity,
      mandatory: app.mandatory,
      effectiveAccess: accessFor(app),
      status: app.status,
      dependencyStatus: dependencyFor(app),
    });

    if (action.kind === 'enable') return <Button size="sm" variant="outline" onClick={() => openDialog({ scope: 'capability', app, mode: 'enable' })}>{controls.enable}</Button>;
    if (action.kind === 'disable') return <Button size="sm" variant="outline" onClick={() => openDialog({ scope: 'capability', app, mode: 'disable' })}>{controls.disable}</Button>;
    if (action.kind === 'unavailable') return <span className="text-xs text-muted">{t('actions.unavailable')}</span>;

    return <div className="space-y-1"><Button size="sm" variant="outline" disabled>{controls.enable}</Button><p className="max-w-48 text-xs leading-relaxed text-muted">{t(`actions.blocked.${action.reason}`)}</p></div>;
  }

  function dialogTitle() {
    if (!dialog) return '';
    if (dialog.scope === 'capability') {
      return t(dialog.mode === 'enable' ? 'enableTitle' : 'disableTitle', { name: labelFor(dialog.app.key) });
    }
    if (dialog.mode === 'enable') return controls.confirmEnable;
    if (dialog.scope === 'all_groups') return controls.globalDisableTitle;
    if (dialog.scope === 'group_capabilities') return controls.childrenDisableTitle;
    return controls.groupDisableTitle;
  }

  function dialogDescription() {
    if (!dialog || dialog.mode === 'enable' || dialog.scope === 'capability') return null;
    if (dialog.scope === 'all_groups') return controls.globalDisableBody;
    if (dialog.scope === 'group_capabilities') return controls.childrenDisableBody;
    return controls.groupDisableBody;
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
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
          <p className="mt-1 max-w-3xl text-sm leading-relaxed text-muted">{t('subtitle')}</p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            disabled={loading || quickAction !== null}
            onClick={() => void runAction({ scope: 'all_groups', mode: 'enable' }, false)}
          >
            {controls.enableAll}
          </Button>
          <Button
            variant="outline"
            disabled={loading || quickAction !== null}
            onClick={() => openDialog({ scope: 'all_groups', mode: 'disable' })}
          >
            {controls.disableAll}
          </Button>
        </div>
      </div>

      <Card>
        <CardHeader>
          <div className="flex items-start gap-3">
            <Boxes className="mt-0.5 h-5 w-5 shrink-0 text-primary" strokeWidth={1.7} />
            <div>
              <CardTitle>{controls.principalTitle}</CardTitle>
              <p className="mt-1 text-sm text-muted">{controls.principalDescription}</p>
            </div>
          </div>
        </CardHeader>
        <Tabs tabs={tabs} value={groupFilter} onChange={setGroupFilter} />
        <CardContent className="space-y-5">
          {loading ? (
            <div className="space-y-2" aria-label={tc('loading')}>{[0, 1, 2].map((item) => <div key={item} className="h-24 animate-pulse rounded-md bg-muted" />)}</div>
          ) : loadError ? (
            <p role="alert" className="rounded-md bg-negative/10 px-3 py-2 text-sm text-negative">{loadError}</p>
          ) : visibleGroups.length === 0 ? (
            <div className="rounded-md border border-dashed border-border px-4 py-12 text-center"><LayoutGrid className="mx-auto h-7 w-7 text-muted" strokeWidth={1.6} /><p className="mt-3 font-medium text-text">{t('emptyTitle')}</p></div>
          ) : (
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
              {visibleGroups.map((group) => {
                const busy = quickAction?.endsWith(`:${group.key}`) ?? false;
                return (
                  <section key={group.key} className="rounded-md border border-border bg-surface p-4">
                    <div className="flex items-start justify-between gap-4">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="font-semibold text-text">{groupLabels[group.key] ?? group.key}</h2>
                          <Badge tone={group.enabled ? 'positive' : 'muted'}>{group.enabled ? controls.enabled : controls.disabled}</Badge>
                        </div>
                        <p className="mt-1 text-xs leading-relaxed text-muted">{controls.childrenDescription}</p>
                      </div>
                      <Switch
                        checked={group.enabled}
                        disabled={!group.manageable || busy || quickAction !== null && !busy}
                        aria-label={`${group.enabled ? controls.disable : controls.enable} ${groupLabels[group.key] ?? group.key}`}
                        onCheckedChange={(checked) => toggleGroup(group, checked)}
                      />
                    </div>
                    <div className="mt-4 flex flex-wrap gap-2 border-t border-border pt-3">
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!group.manageable || quickAction !== null}
                        onClick={() => void runAction({ scope: 'group_capabilities', mode: 'enable', group }, false)}
                      >
                        {controls.enableAll}
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        disabled={!group.manageable || quickAction !== null}
                        onClick={() => openDialog({ scope: 'group_capabilities', mode: 'disable', group })}
                      >
                        {controls.disableAll}
                      </Button>
                    </div>
                  </section>
                );
              })}
            </div>
          )}

          {!loading && !loadError && visible.length > 0 && (
            <>
              <div className="hidden overflow-x-auto border-t border-border pt-2 lg:block">
                <table className="w-full min-w-[68rem] text-sm">
                  <thead className="border-b border-border text-start text-muted"><tr>
                    <th className="px-3 py-3 font-medium">{t('columns.name')}</th><th className="px-3 py-3 font-medium">{t('columns.group')}</th><th className="px-3 py-3 font-medium">{t('columns.commercial')}</th><th className="px-3 py-3 font-medium">{t('columns.access')}</th><th className="px-3 py-3 font-medium">{t('columns.operational')}</th><th className="px-3 py-3 font-medium">{t('columns.dependencies')}</th><th className="px-3 py-3 text-end font-medium">{t('columns.actions')}</th>
                  </tr></thead>
                  <tbody>{visible.map((app) => <tr key={app.key} className={`border-b border-border/70 last:border-0 ${app.maturity !== 'built' ? 'opacity-70' : ''}`}>
                    <td className="px-3 py-3 font-medium text-text">{labelFor(app.key)}</td><td className="px-3 py-3 text-muted">{groupLabels[app.group] ?? app.group}</td><td className="px-3 py-3">{commercialBadge(app)}{commercialDetail(app)}</td><td className="px-3 py-3">{accessBadge(app)}</td><td className="px-3 py-3">{operationalBadge(app)}</td><td className="px-3 py-3">{dependencyBadge(app)}</td><td className="px-3 py-3 text-end">{actionsCell(app)}</td>
                  </tr>)}</tbody>
                </table>
              </div>
              <div className="space-y-3 border-t border-border pt-3 lg:hidden">{visible.map((app) => <article key={app.key} className={`rounded-md border border-border p-3 ${app.maturity !== 'built' ? 'opacity-70' : ''}`}>
                <div className="flex items-start justify-between gap-3"><div className="min-w-0"><h2 className="font-medium text-text">{labelFor(app.key)}</h2><p className="mt-1 text-sm text-muted">{groupLabels[app.group] ?? app.group}</p></div>{operationalBadge(app)}</div>
                <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-3 border-t border-border pt-3 text-xs"><div><dt className="text-muted">{t('columns.commercial')}</dt><dd className="mt-1">{commercialBadge(app)}{commercialDetail(app)}</dd></div><div><dt className="text-muted">{t('columns.access')}</dt><dd className="mt-1">{accessBadge(app)}</dd></div><div><dt className="text-muted">{t('columns.dependencies')}</dt><dd className="mt-1">{dependencyBadge(app)}</dd></div><div><dt className="text-muted">{t('columns.operational')}</dt><dd className="mt-1">{operationalBadge(app)}</dd></div></dl>
                <div className="mt-3 border-t border-border pt-3">{actionsCell(app)}</div>
              </article>)}</div>
            </>
          )}
          <div role="status" aria-atomic="true" className="flex items-center gap-2 text-xs text-muted"><CircleAlert className="h-4 w-4 shrink-0" strokeWidth={1.6} />{t('securityNotice')}</div>
        </CardContent>
      </Card>

      <Dialog open={dialog !== null} onClose={() => setDialog(null)} title={dialogTitle()}>
        {dialog && <div className="space-y-4">{dialogDescription() && <p className="text-sm leading-relaxed text-muted">{dialogDescription()}</p>}<div className="space-y-1.5"><Label htmlFor="application-reason">{t('reasonLabel')}</Label><Textarea id="application-reason" value={reason} onChange={(event) => setReason(event.target.value)} /></div>{dialogError && <p role="alert" className="rounded-md bg-negative/10 px-3 py-2 text-xs text-negative">{dialogError}</p>}<div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setDialog(null)}>{tc('cancel')}</Button><Button disabled={acting} onClick={confirmAction}>{acting ? <><Clock3 className="me-2 h-4 w-4 animate-spin" />{tc('loading')}</> : dialog.mode === 'enable' ? controls.enable : controls.disable}</Button></div></div>}
      </Dialog>
    </div>
  );
}
