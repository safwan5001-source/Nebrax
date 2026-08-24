'use client';
import { ARABIC_DISPLAY_LOCALE, displayLocale } from '@/lib/formatting';

import * as React from 'react';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Boxes, CalendarClock, Eye, Plus, RefreshCw, Search, ShieldCheck, XCircle } from 'lucide-react';
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

type AssignmentKind = 'plan' | 'addon' | 'trial';
type TrialTarget = 'plan' | 'addon';
type CommercialAvailability = 'included' | 'addon' | 'trial' | 'not_available';
type EffectiveAccess = 'full' | 'read_only' | 'denied';
type OperationalState = 'enabled' | 'disabled' | 'suspended';
type AssignmentAction = 'cancel' | 'revoke' | 'schedule';

interface ProductVersion {
  id: string;
  version: number;
  published_at: string | null;
  retired_at: string | null;
  capabilities: string[];
}

interface CommercialProduct {
  id: string;
  code: string;
  name: string;
  versions: ProductVersion[];
}

interface CommercialPlanVersion {
  id: string;
  plan_code: string;
  version: number;
  published_at: string | null;
  retired_at: string | null;
  product_version_ids: string[];
}

interface Catalog {
  products: CommercialProduct[];
  plans: CommercialPlanVersion[];
}

interface ApplicationEntry {
  key: string;
  group: string;
  maturity: 'built' | 'coming_soon' | 'retired';
  mandatory: boolean;
  dependencies: string[];
  enabled: boolean;
  status: OperationalState;
  changed_at: string | null;
  reason: string | null;
  commercial: {
    availability: CommercialAvailability;
    source_count: number;
    source_types: string[];
    trial_until: string | null;
    cancels_at: string | null;
    expired: boolean;
  };
  effective_access: EffectiveAccess;
  dependency_status: 'satisfied' | 'missing' | 'not_applicable';
}

interface AssignmentProductVersion {
  id: string;
  version: number;
  product_code: string | null;
  product_name: string | null;
}

interface AssignmentPlanVersion {
  id: string;
  plan_code: string;
  version: number;
}

interface Assignment {
  id: string;
  source_type: AssignmentKind;
  status: string;
  lifecycle_state: string;
  starts_at: string | null;
  ends_at: string | null;
  scheduled_cancellation_at: string | null;
  ended_at: string | null;
  cancelled_at?: string | null;
  revoked_at?: string | null;
  reason: string | null;
  plan_version: AssignmentPlanVersion | null;
  product_version: AssignmentProductVersion | null;
}

interface CommercialSummary {
  current_plan: Assignment | null;
  included_products: AssignmentProductVersion[];
  active_addons: Assignment[];
  trials: Assignment[];
  legacy_entitlements: Array<{ capability_key: string; access_mode: string; starts_at: string | null; ends_at: string | null }>;
  ended_assignments: Assignment[];
}

interface CommercialApplicationsResponse {
  applications: ApplicationEntry[];
  commercial_summary: CommercialSummary;
}

interface Preview {
  source_type: string;
  target_version_id: string;
  starts_at: string;
  ends_at: string | null;
  products: unknown[];
  capabilities: string[];
  existing_grants: Array<{ capability_key: string; access_mode: string; source_type: string }>;
  grants_to_create: Array<{ capability_key: string; access_mode: string }>;
  conflicts: string[];
  resulting_effective_access: Array<{ capability_key: string; access_mode: string }>;
  idempotent_existing: boolean;
}

interface Inspection {
  capability_key: string;
  operation_class: string;
  effective_access: { level: 'allowed' | 'read_only' | 'denied'; reason: string };
  commercial_sources: Array<{ source_type: string; access_mode: string; source_reference_id: string; lifecycle_access: string | null; starts_at: string | null; ends_at: string | null }>;
  tenant_application_state: { status: OperationalState };
  dependencies: Array<{ capability_key: string; effective_access: string }>;
  rbac: { evaluated: boolean; reason: string };
}

const availabilityTone: Record<CommercialAvailability, 'positive' | 'neutral' | 'warning' | 'muted'> = {
  included: 'positive', addon: 'neutral', trial: 'warning', not_available: 'muted',
};
const accessTone: Record<EffectiveAccess, 'positive' | 'warning' | 'negative'> = {
  full: 'positive', read_only: 'warning', denied: 'negative',
};

function dateValue(value: string | null): string {
  if (!value) return '';
  return value.slice(0, 10);
}

function formatDate(value: string | null, locale: string): string {
  if (!value) return '—';
  return new Intl.DateTimeFormat(displayLocale(locale), { dateStyle: 'medium' }).format(new Date(value));
}

export function CommercialOperationsCard({ tenantId, onChanged }: { tenantId: string; onChanged?: () => void }) {
  const t = useTranslations('platformTenants');
  const [catalog, setCatalog] = useState<Catalog | null>(null);
  const [applications, setApplications] = useState<ApplicationEntry[]>([]);
  const [summary, setSummary] = useState<CommercialSummary | null>(null);
  const [assignments, setAssignments] = useState<Assignment[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [assignOpen, setAssignOpen] = useState(false);
  const [assignmentKind, setAssignmentKind] = useState<AssignmentKind>('addon');
  const [trialTarget, setTrialTarget] = useState<TrialTarget>('addon');
  const [productCode, setProductCode] = useState('');
  const [versionId, setVersionId] = useState('');
  const [startsAt, setStartsAt] = useState(() => new Date().toISOString().slice(0, 10));
  const [endsAt, setEndsAt] = useState('');
  const [durationDays, setDurationDays] = useState('14');
  const [reason, setReason] = useState('');
  const [preview, setPreview] = useState<Preview | null>(null);
  const [formError, setFormError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [capability, setCapability] = useState('');
  const [operation, setOperation] = useState('read');
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [actionDialog, setActionDialog] = useState<{ assignment: Assignment; action: AssignmentAction } | null>(null);
  const [actionReason, setActionReason] = useState('');
  const [effectiveAt, setEffectiveAt] = useState(() => new Date().toISOString().slice(0, 10));

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [stateResponse, catalogResponse, assignmentResponse] = await Promise.all([
        platformApi<{ data: CommercialApplicationsResponse }>(`/platform/tenants/${tenantId}/commercial-applications`),
        platformApi<{ data: Catalog }>('/platform/commercial-catalog'),
        platformApi<{ data: Assignment[] }>(`/platform/tenants/${tenantId}/commercial-assignments`),
      ]);
      setApplications(stateResponse.data.applications);
      setSummary(stateResponse.data.commercial_summary);
      setCatalog(catalogResponse.data);
      setAssignments(assignmentResponse.data);
      setCapability((current) => current || stateResponse.data.applications.find((app) => app.maturity === 'built')?.key || '');
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : t('commercialLoadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t, tenantId]);

  useEffect(() => { load(); }, [load]);

  const publishedProducts = useMemo(() => (catalog?.products ?? []).map((product) => ({
    ...product,
    versions: product.versions.filter((version) => version.published_at && !version.retired_at),
  })).filter((product) => product.versions.length > 0), [catalog]);
  const publishedPlans = useMemo(() => (catalog?.plans ?? []).filter((plan) => plan.published_at && !plan.retired_at), [catalog]);
  const targetKind: TrialTarget = assignmentKind === 'trial' ? trialTarget : assignmentKind;
  const selectedProduct = publishedProducts.find((product) => product.code === productCode) ?? null;
  const selectableVersions = targetKind === 'addon' ? selectedProduct?.versions ?? [] : publishedPlans;

  const productRows = useMemo(() => publishedProducts.map((product) => {
    const capabilityKeys = Array.from(new Set(product.versions.flatMap((version) => version.capabilities)));
    const capabilityApps = applications.filter((app) => capabilityKeys.includes(app.key));
    const directAssignments = assignments.filter((assignment) => assignment.product_version?.product_code === product.code);
    const planned = assignments.some((assignment) => assignment.source_type === 'plan' && assignment.status === 'active' && assignment.plan_version &&
      (catalog?.plans.find((plan) => plan.id === assignment.plan_version?.id)?.product_version_ids.some((id) => product.versions.some((version) => version.id === id)) ?? false));
    const active = directAssignments.find((assignment) => assignment.status === 'active' && (!assignment.ends_at || new Date(assignment.ends_at) > new Date()));
    const latest = directAssignments[0];
    const commercial: string = active?.scheduled_cancellation_at ? 'scheduled'
      : active?.source_type === 'trial' ? 'trial'
      : active?.source_type === 'addon' ? 'addon'
      : planned ? 'included'
      : latest?.lifecycle_state === 'expired' ? 'expired'
      : latest?.status === 'revoked' ? 'revoked'
      : latest?.status === 'cancelled' ? 'cancelled'
      : 'not_assigned';
    const access: EffectiveAccess = capabilityApps.some((app) => app.effective_access === 'denied') ? 'denied'
      : capabilityApps.some((app) => app.effective_access === 'read_only') ? 'read_only'
      : capabilityApps.length > 0 ? 'full' : 'denied';
    const operational: OperationalState = capabilityApps.some((app) => app.status === 'disabled') ? 'disabled'
      : capabilityApps.some((app) => app.status === 'suspended') ? 'suspended' : 'enabled';
    return { product, capabilityApps, commercial, access, operational, activeAssignment: active ?? null };
  }), [applications, assignments, catalog?.plans, publishedProducts]);

  function resetPreview() {
    setPreview(null);
    setFormError(null);
  }

  function resetAssignmentForm() {
    setAssignmentKind('addon');
    setTrialTarget('addon');
    setProductCode('');
    setVersionId('');
    setStartsAt(new Date().toISOString().slice(0, 10));
    setEndsAt('');
    setDurationDays('14');
    setReason('');
    setPreview(null);
    setFormError(null);
  }

  function openAssign() {
    resetAssignmentForm();
    setAssignOpen(true);
  }

  function changeKind(value: AssignmentKind) {
    setAssignmentKind(value);
    setProductCode('');
    setVersionId('');
    resetPreview();
  }

  async function previewAssignment() {
    if (!versionId || !startsAt) {
      setFormError(t('commercialFormMissing'));
      return;
    }
    setActing(true);
    setFormError(null);
    try {
      const payload: Record<string, unknown> = {
        source_type: assignmentKind,
        version_id: versionId,
        starts_at: `${startsAt}T00:00:00Z`,
      };
      if (assignmentKind === 'trial') {
        payload.trial_target = trialTarget;
        payload.duration_days = Number(durationDays);
      } else if (endsAt) {
        payload.ends_at = `${endsAt}T00:00:00Z`;
      }
      const response = await platformApi<{ data: Preview }>(`/platform/tenants/${tenantId}/commercial-assignments/preview`, { method: 'POST', body: payload });
      setPreview(response.data);
    } catch (reason) {
      setFormError(reason instanceof ApiError ? reason.message : t('commercialPreviewFailed'));
    } finally {
      setActing(false);
    }
  }

  async function applyAssignment() {
    if (!preview || preview.conflicts.length > 0) return;
    setActing(true);
    setFormError(null);
    try {
      let path: string;
      let body: Record<string, unknown>;
      if (assignmentKind === 'trial') {
        path = `/platform/tenants/${tenantId}/commercial-trials/${trialTarget}`;
        body = { version_id: versionId, starts_at: `${startsAt}T00:00:00Z`, duration_days: Number(durationDays), reason: reason.trim() || undefined };
      } else {
        path = `/platform/tenants/${tenantId}/commercial-assignments/${assignmentKind}`;
        body = { version_id: versionId, starts_at: `${startsAt}T00:00:00Z`, ends_at: endsAt ? `${endsAt}T00:00:00Z` : undefined, reason: reason.trim() || undefined };
      }
      await platformApi(path, { method: 'POST', body });
      setAssignOpen(false);
      await load();
      onChanged?.();
    } catch (reason) {
      setFormError(reason instanceof ApiError ? reason.message : t('commercialApplyFailed'));
    } finally {
      setActing(false);
    }
  }

  async function inspect() {
    if (!capability) return;
    setActing(true);
    setError(null);
    try {
      const response = await platformApi<{ data: Inspection }>(`/platform/tenants/${tenantId}/commercial-access/${encodeURIComponent(capability)}?operation=${operation}`);
      setInspection(response.data);
    } catch (reason) {
      setError(reason instanceof ApiError ? reason.message : t('commercialLoadFailed'));
    } finally {
      setActing(false);
    }
  }

  async function submitAction() {
    if (!actionDialog) return;
    setActing(true);
    setFormError(null);
    try {
      const { assignment, action } = actionDialog;
      const path = action === 'schedule'
        ? `/platform/tenants/${tenantId}/commercial-assignments/${assignment.id}/schedule-cancellation`
        : `/platform/tenants/${tenantId}/commercial-assignments/${assignment.id}/${action}`;
      await platformApi(path, {
        method: 'POST',
        body: action === 'schedule'
          ? { effective_at: `${effectiveAt}T00:00:00Z`, reason: actionReason.trim() || undefined }
          : { reason: actionReason.trim() || undefined },
      });
      setActionDialog(null);
      await load();
      onChanged?.();
    } catch (reason) {
      setFormError(reason instanceof ApiError ? reason.message : t('commercialActionFailed'));
    } finally {
      setActing(false);
    }
  }

  function commercialBadge(value: string) {
    const tone = value === 'included' ? 'positive' : value === 'trial' || value === 'scheduled' ? 'warning' : value === 'not_assigned' ? 'muted' : value === 'addon' ? 'neutral' : 'negative';
    return <Badge tone={tone}>{t(`commercialStatus.${value}`)}</Badge>;
  }

  function accessBadge(value: EffectiveAccess) {
    return <Badge tone={accessTone[value]}>{t(`effectiveAccess.${value}`)}</Badge>;
  }

  function operationalBadge(value: OperationalState) {
    const tone = value === 'enabled' ? 'positive' : value === 'suspended' ? 'warning' : 'muted';
    return <Badge tone={tone}>{t(`operationalState.${value}`)}</Badge>;
  }

  function assignmentLabel(assignment: Assignment) {
    if (assignment.plan_version) return `${assignment.plan_version.plan_code} v${assignment.plan_version.version}`;
    if (assignment.product_version) return `${assignment.product_version.product_name ?? assignment.product_version.product_code ?? t('unknownProduct')} v${assignment.product_version.version}`;
    return assignment.id;
  }

  return (
    <Card>
      <CardHeader className="flex flex-row items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Boxes className="mt-0.5 h-5 w-5 shrink-0 text-primary" strokeWidth={1.7} aria-hidden="true" />
          <div><CardTitle>{t('subscriptionApplications')}</CardTitle><p className="mt-1 text-sm text-muted">{t('subscriptionApplicationsNotice')}</p></div>
        </div>
        <div className="flex shrink-0 gap-2"><Button size="sm" variant="outline" onClick={load} disabled={loading || acting}><RefreshCw className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />{t('retry')}</Button><Button size="sm" onClick={openAssign} disabled={loading}><Plus className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />{t('assignApplication')}</Button></div>
      </CardHeader>
      <CardContent className="space-y-5">
        {error && <p role="alert" className="rounded-md bg-negative/10 px-3 py-2 text-sm text-negative">{error}</p>}
        {loading ? <div className="space-y-2">{[0, 1, 2].map((item) => <div key={item} className="h-14 animate-pulse rounded-md bg-muted" />)}</div> : <>
          <section className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <SummaryItem label={t('currentCommercialPlan')} value={summary?.current_plan ? assignmentLabel(summary.current_plan) : t('noCommercialPlan')} />
            <SummaryItem label={t('includedProducts')} value={String(summary?.included_products.length ?? 0)} />
            <SummaryItem label={t('activeAddons')} value={String(summary?.active_addons.length ?? 0)} />
            <SummaryItem label={t('activeTrials')} value={String(summary?.trials.length ?? 0)} />
          </section>

          <section className="space-y-3 border-t border-border pt-5">
            <div className="flex flex-wrap items-end justify-between gap-3"><div><h3 className="font-medium text-text">{t('applicationProducts')}</h3><p className="mt-1 text-xs text-muted">{t('applicationProductsNotice')}</p></div><p className="text-xs text-muted">{t('operationalReadOnly')}</p></div>
            {productRows.length === 0 ? <Empty label={t('noCommercialProducts')} /> : <>
              <div className="hidden overflow-x-auto lg:block"><table className="w-full min-w-[56rem] text-sm"><thead className="border-b border-border text-start text-xs text-muted"><tr><th className="px-3 py-2.5 font-medium">{t('commercialProduct')}</th><th className="px-3 py-2.5 font-medium">{t('commercialStatusLabel')}</th><th className="px-3 py-2.5 font-medium">{t('effectiveAccessLabel')}</th><th className="px-3 py-2.5 font-medium">{t('operationalStateLabel')}</th><th className="px-3 py-2.5 font-medium">{t('dependenciesLabel')}</th></tr></thead><tbody>{productRows.map((row) => <tr key={row.product.id} className="border-b border-border/70 last:border-0"><td className="px-3 py-3"><p className="font-medium text-text">{row.product.name}</p><p className="num mt-1 text-xs text-muted">{row.product.code}</p></td><td className="px-3 py-3">{commercialBadge(row.commercial)}</td><td className="px-3 py-3">{accessBadge(row.access)}</td><td className="px-3 py-3">{operationalBadge(row.operational)}</td><td className="px-3 py-3 text-xs text-muted">{row.capabilityApps.flatMap((app) => app.dependencies).join('، ') || '—'}</td></tr>)}</tbody></table></div>
              <div className="space-y-3 lg:hidden">{productRows.map((row) => <article key={row.product.id} className="rounded-md border border-border p-3"><div className="flex items-start justify-between gap-3"><div><h4 className="font-medium text-text">{row.product.name}</h4><p className="num mt-1 text-xs text-muted">{row.product.code}</p></div>{commercialBadge(row.commercial)}</div><dl className="mt-3 grid grid-cols-2 gap-3 border-t border-border pt-3 text-xs"><div><dt className="text-muted">{t('effectiveAccessLabel')}</dt><dd className="mt-1">{accessBadge(row.access)}</dd></div><div><dt className="text-muted">{t('operationalStateLabel')}</dt><dd className="mt-1">{operationalBadge(row.operational)}</dd></div></dl></article>)}</div>
            </>}
          </section>

          <section className="grid gap-3 border-t border-border pt-5 lg:grid-cols-3">
            <CompactList title={t('includedProducts')} items={summary?.included_products.map((item) => `${item.product_name ?? item.product_code ?? t('unknownProduct')} v${item.version}`) ?? []} empty={t('none')} />
            <CompactList title={t('legacyEntitlements')} items={summary?.legacy_entitlements.map((item) => `${item.capability_key} · ${item.access_mode}`) ?? []} empty={t('noLegacyEntitlements')} />
            <CompactList title={t('endedAssignments')} items={summary?.ended_assignments.map((item) => `${assignmentLabel(item)} · ${t(`assignmentLifecycle.${item.lifecycle_state}`)}`) ?? []} empty={t('noEndedAssignments')} />
          </section>

          <section className="space-y-3 border-t border-border pt-5">
            <div><h3 className="font-medium text-text">{t('commercialHistory')}</h3><p className="mt-1 text-xs text-muted">{t('commercialHistoryNotice')}</p></div>
            {assignments.length === 0 ? <Empty label={t('noCommercialHistory')} /> : <div className="space-y-2">{assignments.map((assignment) => <article key={assignment.id} className="rounded-md border border-border p-3"><div className="flex flex-wrap items-start justify-between gap-3"><div><p className="font-medium text-text">{assignmentLabel(assignment)}</p><p className="mt-1 text-xs text-muted">{t(`assignmentSource.${assignment.source_type}`)} · {formatDate(assignment.starts_at, ARABIC_DISPLAY_LOCALE)} — {formatDate(assignment.ends_at, ARABIC_DISPLAY_LOCALE)}</p></div><div className="flex flex-wrap items-center gap-2">{commercialBadge(assignment.status === 'active' ? assignment.lifecycle_state === 'scheduled_cancellation' ? 'scheduled' : assignment.source_type === 'trial' ? 'trial' : assignment.source_type === 'addon' ? 'addon' : 'included' : assignment.status)}<Badge tone="neutral">{t(`assignmentLifecycle.${assignment.lifecycle_state}`)}</Badge></div></div>{assignment.reason && <p className="mt-2 text-xs text-muted">{assignment.reason}</p>}{assignment.status === 'active' && <div className="mt-3 flex flex-wrap gap-2 border-t border-border pt-3"><Button size="sm" variant="outline" onClick={() => { setActionDialog({ assignment, action: 'schedule' }); setActionReason(''); setFormError(null); }}>{t('scheduleCancellation')}</Button><Button size="sm" variant="outline" onClick={() => { setActionDialog({ assignment, action: 'cancel' }); setActionReason(''); setFormError(null); }}>{assignment.source_type === 'trial' ? t('endTrial') : t('cancelAssignment')}</Button><Button size="sm" variant="danger" onClick={() => { setActionDialog({ assignment, action: 'revoke' }); setActionReason(''); setFormError(null); }}><XCircle className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />{t('revokeAssignment')}</Button></div>}</article>)}</div>}
          </section>

          <section className="space-y-3 border-t border-border pt-5">
            <div className="flex items-start gap-3"><ShieldCheck className="mt-0.5 h-5 w-5 shrink-0 text-primary" strokeWidth={1.7} aria-hidden="true" /><div><h3 className="font-medium text-text">{t('accessInspector')}</h3><p className="mt-1 text-xs text-muted">{t('accessInspectorNotice')}</p></div></div>
            <div className="flex flex-wrap items-end gap-2"><div className="min-w-52 flex-1"><Label htmlFor="commercial-capability">{t('capabilityKey')}</Label><Select id="commercial-capability" value={capability} onChange={(event) => setCapability(event.target.value)} className="mt-1.5 w-full"><option value="">{t('selectCapability')}</option>{applications.filter((app) => app.maturity === 'built').map((app) => <option key={app.key} value={app.key}>{app.key}</option>)}</Select></div><div className="w-40"><Label htmlFor="commercial-operation">{t('operationClass')}</Label><Select id="commercial-operation" value={operation} onChange={(event) => setOperation(event.target.value)} className="mt-1.5 w-full">{['read', 'write', 'transition', 'destructive', 'export'].map((item) => <option key={item} value={item}>{t(`operation.${item}`)}</option>)}</Select></div><Button onClick={inspect} disabled={acting || !capability}><Search className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />{t('inspectAccess')}</Button></div>
            {inspection && <div className="rounded-md border border-border p-3"><div className="flex flex-wrap items-center gap-2">{inspection.effective_access.level === 'allowed' ? accessBadge('full') : inspection.effective_access.level === 'read_only' ? accessBadge('read_only') : accessBadge('denied')}<span className="num text-xs text-muted">{inspection.effective_access.reason}</span></div><dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2 lg:grid-cols-3"><InspectorItem label={t('commercialSources')} value={inspection.commercial_sources.map((source) => `${t(`assignmentSource.${source.source_type}`)}: ${source.access_mode}`).join('، ') || '—'} /><InspectorItem label={t('applicationState')} value={t(`operationalState.${inspection.tenant_application_state.status}`)} /><InspectorItem label={t('dependenciesLabel')} value={inspection.dependencies.map((dependency) => `${dependency.capability_key}: ${dependency.effective_access}`).join('، ') || t('none')} /><InspectorItem label={t('rbacLabel')} value={inspection.rbac.evaluated ? inspection.rbac.reason : t('rbacNotEvaluated')} /><InspectorItem label={t('finalDecision')} value={`${inspection.effective_access.level} · ${inspection.effective_access.reason}`} /></dl></div>}
          </section>
        </>}
      </CardContent>

      <Dialog open={assignOpen} onClose={() => setAssignOpen(false)} title={t('assignApplication')} className="max-w-4xl">
        <div className="space-y-4"><p className="text-sm text-muted">{t('assignmentDialogNotice')}</p><div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="assignment-kind">{t('assignmentType')}</Label><Select id="assignment-kind" value={assignmentKind} onChange={(event) => changeKind(event.target.value as AssignmentKind)} className="mt-1.5 w-full"><option value="addon">{t('assignmentTypeAddon')}</option><option value="plan">{t('assignmentTypePlan')}</option><option value="trial">{t('assignmentTypeTrial')}</option></Select></div>{assignmentKind === 'trial' && <div><Label htmlFor="trial-target">{t('trialTarget')}</Label><Select id="trial-target" value={trialTarget} onChange={(event) => { setTrialTarget(event.target.value as TrialTarget); setProductCode(''); setVersionId(''); resetPreview(); }} className="mt-1.5 w-full"><option value="addon">{t('assignmentTypeAddon')}</option><option value="plan">{t('assignmentTypePlan')}</option></Select></div>}</div>
          {targetKind === 'addon' && <div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="commercial-product">{t('commercialProduct')}</Label><Select id="commercial-product" value={productCode} onChange={(event) => { setProductCode(event.target.value); setVersionId(''); resetPreview(); }} className="mt-1.5 w-full"><option value="">{t('selectProduct')}</option>{publishedProducts.map((product) => <option key={product.id} value={product.code}>{product.name} · {product.code}</option>)}</Select></div><div><Label htmlFor="commercial-version">{t('productVersion')}</Label><Select id="commercial-version" value={versionId} onChange={(event) => { setVersionId(event.target.value); resetPreview(); }} disabled={!selectedProduct} className="mt-1.5 w-full"><option value="">{t('selectVersion')}</option>{selectableVersions.map((version) => <option key={version.id} value={version.id}>v{version.version}</option>)}</Select></div></div>}
          {targetKind === 'plan' && <div><Label htmlFor="commercial-plan-version">{t('planVersion')}</Label><Select id="commercial-plan-version" value={versionId} onChange={(event) => { setVersionId(event.target.value); resetPreview(); }} className="mt-1.5 w-full"><option value="">{t('selectVersion')}</option>{publishedPlans.map((plan) => <option key={plan.id} value={plan.id}>{plan.plan_code} · v{plan.version}</option>)}</Select></div>}
          <div className="grid gap-3 sm:grid-cols-2"><div><Label htmlFor="assignment-start">{t('startDate')}</Label><Input id="assignment-start" type="date" value={startsAt} onChange={(event) => { setStartsAt(event.target.value); resetPreview(); }} className="mt-1.5" /></div>{assignmentKind === 'trial' ? <div><Label htmlFor="trial-duration">{t('trialDurationDays')}</Label><Input id="trial-duration" min="1" max="90" type="number" value={durationDays} onChange={(event) => { setDurationDays(event.target.value); resetPreview(); }} className="mt-1.5" /></div> : <div><Label htmlFor="assignment-end">{t('endDateOptional')}</Label><Input id="assignment-end" min={startsAt} type="date" value={endsAt} onChange={(event) => { setEndsAt(event.target.value); resetPreview(); }} className="mt-1.5" /></div>}</div><div><Label htmlFor="assignment-reason">{t('reason')}</Label><Textarea id="assignment-reason" value={reason} onChange={(event) => { setReason(event.target.value); resetPreview(); }} className="mt-1.5" /></div>{formError && <p role="alert" className="rounded-md bg-negative/10 px-3 py-2 text-sm text-negative">{formError}</p>}
          {preview && <PreviewPanel preview={preview} t={t} />}
          <div className="flex flex-wrap justify-end gap-2"><Button variant="outline" onClick={() => setAssignOpen(false)}>{t('close')}</Button><Button variant="outline" onClick={previewAssignment} disabled={acting}><Eye className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />{t('previewAssignment')}</Button><Button onClick={applyAssignment} disabled={acting || !preview || preview.conflicts.length > 0}><Plus className="h-4 w-4" strokeWidth={1.7} aria-hidden="true" />{t('applyAssignment')}</Button></div>
        </div>
      </Dialog>

      <Dialog open={actionDialog !== null} onClose={() => setActionDialog(null)} title={actionDialog ? t(`assignmentActionTitle.${actionDialog.action}`, { name: assignmentLabel(actionDialog.assignment) }) : ''}>
        <div className="space-y-4">{actionDialog?.action === 'schedule' && <div><Label htmlFor="cancellation-date">{t('effectiveDate')}</Label><Input id="cancellation-date" type="date" value={effectiveAt} onChange={(event) => setEffectiveAt(event.target.value)} className="mt-1.5" /></div>}<div><Label htmlFor="assignment-action-reason">{t('reason')}</Label><Textarea id="assignment-action-reason" value={actionReason} onChange={(event) => setActionReason(event.target.value)} className="mt-1.5" /></div>{formError && <p role="alert" className="rounded-md bg-negative/10 px-3 py-2 text-sm text-negative">{formError}</p>}<div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setActionDialog(null)}>{t('close')}</Button><Button variant={actionDialog?.action === 'revoke' ? 'danger' : 'primary'} disabled={acting} onClick={submitAction}>{t(`assignmentAction.${actionDialog?.action ?? 'cancel'}`)}</Button></div></div>
      </Dialog>
    </Card>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return <div className="rounded-md border border-border bg-background px-3 py-2.5"><p className="text-xs text-muted">{label}</p><p className="mt-1 truncate text-sm font-medium text-text">{value}</p></div>;
}

function CompactList({ title, items, empty }: { title: string; items: string[]; empty: string }) {
  return <div className="rounded-md border border-border p-3"><h3 className="text-sm font-medium text-text">{title}</h3>{items.length === 0 ? <p className="mt-2 text-xs text-muted">{empty}</p> : <ul className="mt-2 space-y-1.5 text-xs text-muted">{items.map((item, index) => <li key={`${item}-${index}`} className="break-words">{item}</li>)}</ul>}</div>;
}

function InspectorItem({ label, value }: { label: string; value: string }) {
  return <div><dt className="text-muted">{label}</dt><dd className="mt-1 break-words text-text">{value}</dd></div>;
}

function Empty({ label }: { label: string }) {
  return <div className="rounded-md border border-dashed border-border px-4 py-6 text-center text-sm text-muted">{label}</div>;
}

function PreviewPanel({ preview, t }: { preview: Preview; t: ReturnType<typeof useTranslations> }) {
  return <section className="rounded-md border border-border bg-background p-3"><div className="flex flex-wrap items-center gap-2"><CalendarClock className="h-4 w-4 text-primary" strokeWidth={1.7} aria-hidden="true" /><h3 className="text-sm font-medium text-text">{t('assignmentPreview')}</h3>{preview.idempotent_existing && <Badge tone="neutral">{t('idempotentAssignment')}</Badge>}</div><dl className="mt-3 grid gap-3 text-xs sm:grid-cols-2"><InspectorItem label={t('previewCapabilities')} value={preview.capabilities.join('، ') || '—'} /><InspectorItem label={t('previewExistingGrants')} value={preview.existing_grants.map((grant) => `${grant.capability_key}: ${grant.access_mode}`).join('، ') || '—'} /><InspectorItem label={t('previewNewGrants')} value={preview.grants_to_create.map((grant) => `${grant.capability_key}: ${grant.access_mode}`).join('، ') || '—'} /><InspectorItem label={t('previewResult')} value={preview.resulting_effective_access.map((grant) => `${grant.capability_key}: ${grant.access_mode}`).join('، ') || '—'} /></dl>{preview.conflicts.length > 0 && <div className="mt-3 rounded-md bg-negative/10 px-3 py-2 text-xs text-negative"><p className="font-medium">{t('previewConflicts')}</p><ul className="mt-1 space-y-1">{preview.conflicts.map((conflict) => <li key={conflict}>{conflict}</li>)}</ul></div>}</section>;
}
