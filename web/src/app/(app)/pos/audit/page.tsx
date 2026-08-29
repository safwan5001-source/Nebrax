'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import type { ColumnDef } from '@tanstack/react-table';
import { ClipboardCheck, Download, Eye, FileClock, ListFilter, RefreshCw, ShieldCheck, UsersRound, WalletCards } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { currentUser } from '@/lib/auth';
import { formatDateTime as formatDate } from '@/lib/formatting';
import { formatRiyal } from '@/lib/money';
import { DataTable } from '@/components/data-table';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Tabs, TabPanel, type TabDef } from '@/components/ui/tabs';
import { useToast } from '@/components/ui/toast';
import { IntelligenceOverviewPanel } from '@/modules/pos-audit/intelligence-overview';
import { ExceptionsPanel } from '@/modules/pos-audit/exceptions-panel';
import { RiskPanel } from '@/modules/pos-audit/risk-panel';
import { RelationshipsPanel } from '@/modules/pos-audit/relationships-panel';
import { RulesPanel } from '@/modules/pos-audit/rules-panel';
import { CasesPanel } from '@/modules/pos-audit/cases-panel';
import { DigestPanel } from '@/modules/pos-audit/digest-panel';
import { NeedsAttentionPanel } from '@/modules/pos-audit/needs-attention-panel';
import { EventDetailDialog, type PosAuditEvent } from '@/modules/pos-audit/event-detail-dialog';

type AuditEvent = PosAuditEvent;
interface AuditOverview { review_activity_count: number; cart_cancellations_count: number; cash_variance_count: number; pending_approvals_count: number; range_started_at: string }
interface CartRow { cart_id: string; pos_session_id: string; branch_id: string | null; created_at: string | null; last_event_at: string | null; last_event_type: string; event_count: number; reason_code: string | null }
interface Approval { id: string; operation: string; status: string; reason_code: string | null; reason_note: string | null; cart_id: string | null; pos_session_id: string; performed_by_user?: { id: string; name: string } | null; approved_by_user?: { id: string; name: string } | null; expires_at: string | null; created_at: string | null }
interface AuditUser { user_id: string; name: string; events_count: number; last_event_at: string | null }
interface ReasonCode { id: string; code: string; name_ar: string; name_en: string; requires_note: boolean; is_active: boolean }

type AuditTab = 'overview' | 'attention' | 'exceptions' | 'risk' | 'relationships' | 'cases' | 'digest' | 'sensitive' | 'carts' | 'cash' | 'users' | 'approvals' | 'settings';

export default function PosAuditPage() {
  const t = useTranslations('posAudit');
  const tc = useTranslations('common');
  const locale = useLocale();
  const { success, error: errorToast } = useToast();
  const user = currentUser();
  const can = useCallback((permission: string) => Boolean(user?.permissions?.includes('*') || user?.permissions?.includes(permission)), [user?.permissions]);
  const [tab, setTab] = useState<AuditTab>('overview');
  const [overview, setOverview] = useState<AuditOverview | null>(null);
  const [events, setEvents] = useState<AuditEvent[]>([]);
  const [carts, setCarts] = useState<CartRow[]>([]);
  const [users, setUsers] = useState<AuditUser[]>([]);
  const [approvals, setApprovals] = useState<Approval[]>([]);
  const [reasonCodes, setReasonCodes] = useState<ReasonCode[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [selectedEvent, setSelectedEvent] = useState<AuditEvent | null>(null);
  const [cartTimeline, setCartTimeline] = useState<{ cartId: string; events: AuditEvent[] } | null>(null);
  const [approving, setApproving] = useState<string | null>(null);
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [filters, setFilters] = useState({ from: '', to: '', pos_session_id: '', user_id: '', type: '', reason_code: '', amount_min: '', amount_max: '' });
  const [focusCaseId, setFocusCaseId] = useState<string | null>(null);

  const canInvestigationsView = can('pos.investigations.view');

  const tabs = useMemo<TabDef[]>(() => {
    const next: TabDef[] = [
      { id: 'overview', label: t('overview') },
      { id: 'attention', label: t('attention.tabLabel') },
      { id: 'exceptions', label: t('exceptions') },
      { id: 'risk', label: t('riskIndicators') },
      { id: 'relationships', label: t('relationships') },
    ];
    if (canInvestigationsView) {
      next.push({ id: 'cases', label: t('cases.tabLabel') });
      next.push({ id: 'digest', label: t('digest.tabLabel') });
    }
    next.push(
      { id: 'sensitive', label: t('sensitive') },
      { id: 'carts', label: t('carts') }, { id: 'cash', label: t('cash') }, { id: 'users', label: t('users') },
    );
    if (can('pos.audit.review') || can('pos.override.approve')) next.push({ id: 'approvals', label: t('approvals'), count: overview?.pending_approvals_count });
    if (can('pos.audit.settings.manage')) next.push({ id: 'settings', label: t('settings') });
    return next;
  }, [can, canInvestigationsView, overview?.pending_approvals_count, t]);

  const query = useMemo(() => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => { if (value) params.set(key, key === 'type' ? value : value); });
    return params.toString();
  }, [filters]);

  const loadCore = useCallback(async () => {
    setLoading(true); setLoadError(null);
    try {
      const [summary, activity, cartRows, userRows] = await Promise.all([
        api<{ data: AuditOverview }>('/pos/audit/overview'),
        api<{ data: AuditEvent[] }>(`/pos/audit/events${query ? `?${query}` : ''}`),
        api<{ data: CartRow[] }>('/pos/audit/carts?per_page=100'),
        api<{ data: AuditUser[] }>('/pos/audit/users'),
      ]);
      setOverview(summary.data); setEvents(activity.data); setCarts(cartRows.data); setUsers(userRows.data);
    } catch (error) {
      setLoadError(error instanceof ApiError ? error.message : t('loadFailed'));
    } finally { setLoading(false); }
  }, [query, t]);

  const loadApprovals = useCallback(async () => {
    if (!can('pos.audit.review') && !can('pos.override.approve')) return;
    try { setApprovals((await api<{ data: Approval[] }>('/pos/audit/approvals')).data); } catch { /* backend remains the guard */ }
  }, [can]);

  const loadReasonCodes = useCallback(async () => {
    if (!can('pos.audit.settings.manage')) return;
    try { setReasonCodes((await api<{ data: ReasonCode[] }>('/pos/reason-codes?include_inactive=1')).data); } catch { /* keep the settings section safely empty */ }
  }, [can]);

  useEffect(() => { void loadCore(); }, [loadCore]);
  useEffect(() => { void loadApprovals(); }, [loadApprovals]);
  useEffect(() => { void loadReasonCodes(); }, [loadReasonCodes]);

  const eventLabel = (type: string): string => String(t(`eventLabels.${type}` as never, { fallback: type }));
  const actorName = (event: AuditEvent) => event.performed_by_user?.name ?? event.actor?.name ?? '—';
  const eventColumns = useMemo<ColumnDef<AuditEvent, unknown>[]>(() => [
    { id: 'time', header: t('time'), accessorFn: (row) => row.created_at ?? '', cell: ({ row }) => <span className="num whitespace-nowrap text-xs">{formatDate(row.original.created_at, locale)}</span> },
    { id: 'event', header: t('event'), accessorFn: (row) => eventLabel(row.type), cell: ({ row }) => <span className="font-medium text-text">{eventLabel(row.original.type)}</span> },
    { id: 'user', header: t('user'), accessorFn: (row) => actorName(row), cell: ({ row }) => <span>{actorName(row.original)}</span> },
    { id: 'value', header: t('value'), accessorFn: (row) => row.amount ?? '', cell: ({ row }) => row.original.amount === null ? '—' : <span className="num">{formatRiyal(row.original.amount)}</span> },
    { id: 'reason', header: t('reason'), accessorFn: (row) => row.reason_code ?? '', cell: ({ row }) => <span className="text-sm text-muted">{row.original.reason_note ?? row.original.reason_code ?? '—'}</span> },
    { id: 'details', header: t('details'), enableSorting: false, cell: ({ row }) => <Button size="sm" variant="outline" onClick={() => setSelectedEvent(row.original)}><Eye className="h-3.5 w-3.5" strokeWidth={1.6} />{t('viewDetails')}</Button> },
  ], [locale, t]);

  async function openCart(cart: CartRow) {
    try {
      const result = await api<{ data: { timeline: AuditEvent[] } }>(`/pos/audit/carts/${cart.cart_id}`);
      setCartTimeline({ cartId: cart.cart_id, events: result.data.timeline });
    } catch (error) { errorToast(error instanceof ApiError ? error.message : t('loadFailed')); }
  }

  async function approve(id: string) {
    setApproving(id);
    try {
      await api(`/pos/audit/approvals/${id}/approve`, { method: 'POST' });
      success(t('approved')); await Promise.all([loadApprovals(), loadCore()]);
    } catch (error) { errorToast(error instanceof ApiError ? error.message : t('loadFailed')); }
    finally { setApproving(null); }
  }

  function exportCsv() {
    const params = query ? `?${query}` : '';
    window.open(`${process.env.NEXT_PUBLIC_API_URL ?? ''}/api/pos/audit/events/export${params}`, '_blank', 'noopener,noreferrer');
  }

  const activity = <DataTable columns={eventColumns} data={events} loading={loading} error={loadError} onRetry={() => void loadCore()} emptyLabel={t('emptyEvents')} searchPlaceholder={t('eventType')} exportName="pos-audit-events" mobileRecord={(row) => ({ title: eventLabel(row.type), subtitle: actorName(row), meta: [formatDate(row.created_at, locale), row.amount ? formatRiyal(row.amount) : '—'], actions: <button className="text-sm font-medium text-primary" onClick={() => setSelectedEvent(row)}>{t('viewDetails')}</button> })} />;

  if (!user) return null;
  return (
    <main className="space-y-5 p-4 lg:p-6">
      <header className="flex flex-col gap-3 border-b border-border pb-4 sm:flex-row sm:items-end sm:justify-between">
        <div><h1 className="text-xl font-semibold tracking-tight text-text">{t('title')}</h1><p className="mt-1 max-w-3xl text-sm text-muted">{t('subtitle')}</p></div>
        <div className="flex gap-2"><Button variant="outline" onClick={() => void loadCore()} disabled={loading}><RefreshCw className="h-4 w-4" strokeWidth={1.6} />{tc('refresh')}</Button>{can('pos.audit.export') && <Button variant="outline" onClick={exportCsv}><Download className="h-4 w-4" strokeWidth={1.6} />{t('export')}</Button>}</div>
      </header>
      <Tabs tabs={tabs} value={tab} onChange={(next) => setTab(next as AuditTab)} />

      <TabPanel id={tab}>
        {tab === 'overview' && <section className="space-y-5">
          <IntelligenceOverviewPanel onOpenExceptions={() => setTab('exceptions')} onOpenRisk={() => setTab('risk')} />
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {[
              [ClipboardCheck, t('activity'), overview?.review_activity_count ?? 0], [FileClock, t('cartCancellations'), overview?.cart_cancellations_count ?? 0],
              [WalletCards, t('cashVariances'), overview?.cash_variance_count ?? 0], [ShieldCheck, t('pendingApprovals'), overview?.pending_approvals_count ?? 0],
            ].map(([Icon, label, value]) => { const CardIcon = Icon as typeof ClipboardCheck; return <article key={label as string} className="rounded border border-border bg-surface p-4"><CardIcon className="h-4 w-4 text-muted" strokeWidth={1.6} aria-hidden="true"/><p className="mt-4 text-sm text-muted">{label as string}</p><p className="num mt-1 text-2xl font-semibold text-text">{value as number}</p><p className="mt-1 text-xs text-muted">{t('last24Hours')}</p></article>; })}
          </div>
          <section><div className="mb-3 flex items-center justify-between"><h2 className="text-base font-semibold text-text">{t('sensitive')}</h2><Button variant="outline" size="sm" onClick={() => setTab('sensitive')}>{t('viewDetails')}</Button></div>{activity}</section>
        </section>}
        {tab === 'attention' && (
          <NeedsAttentionPanel
            canReviewExceptions={can('pos.audit.review')}
            canPromoteExceptions={can('pos.investigations.create')}
            canApprove={can('pos.override.approve')}
            canManageCases={can('pos.investigations.manage')}
            canAssignCases={can('pos.investigations.assign')}
            canResolveCases={can('pos.investigations.resolve')}
            canCctv={can('pos.cctv.bookmark.manage')}
            onOpenDigest={() => setTab('digest')}
            onPromoted={(caseId) => { setFocusCaseId(caseId); setTab('cases'); }}
          />
        )}
        {tab === 'exceptions' && (
          <ExceptionsPanel
            canReview={can('pos.audit.review')}
            canPromote={can('pos.investigations.create')}
            onPromoted={(caseId) => { setFocusCaseId(caseId); setTab('cases'); }}
          />
        )}
        {tab === 'risk' && <RiskPanel />}
        {tab === 'relationships' && <RelationshipsPanel />}
        {tab === 'cases' && canInvestigationsView && (
          <CasesPanel
            canCreate={can('pos.investigations.create')}
            canManage={can('pos.investigations.manage')}
            canAssign={can('pos.investigations.assign')}
            canResolve={can('pos.investigations.resolve')}
            canExport={can('pos.investigations.export')}
            canCctv={can('pos.cctv.bookmark.manage')}
            focusCaseId={focusCaseId}
            onFocusHandled={() => setFocusCaseId(null)}
          />
        )}
        {tab === 'digest' && canInvestigationsView && (
          <DigestPanel
            canManage={can('pos.investigations.manage')}
            onOpenCase={(caseId) => { setFocusCaseId(caseId); setTab('cases'); }}
          />
        )}
        {tab === 'sensitive' && <section className="space-y-4"><details open={filtersOpen} onToggle={(event) => setFiltersOpen((event.currentTarget as HTMLDetailsElement).open)} className="rounded border border-border bg-surface"><summary className="flex cursor-pointer list-none items-center gap-2 p-3 text-sm font-medium text-text"><ListFilter className="h-4 w-4 text-muted" strokeWidth={1.6}/>{t('advancedFilters')}</summary><div className="grid gap-3 border-t border-border p-3 sm:grid-cols-2 xl:grid-cols-4"><label><Label htmlFor="audit-from">{t('dateFrom')}</Label><Input id="audit-from" type="datetime-local" value={filters.from} onChange={(e) => setFilters((v) => ({ ...v, from: e.target.value }))}/></label><label><Label htmlFor="audit-to">{t('dateTo')}</Label><Input id="audit-to" type="datetime-local" value={filters.to} onChange={(e) => setFilters((v) => ({ ...v, to: e.target.value }))}/></label><label><Label htmlFor="audit-session">{t('session')}</Label><Input id="audit-session" value={filters.pos_session_id} onChange={(e) => setFilters((v) => ({ ...v, pos_session_id: e.target.value }))}/></label><label><Label htmlFor="audit-user">{t('user')}</Label><Input id="audit-user" value={filters.user_id} onChange={(e) => setFilters((v) => ({ ...v, user_id: e.target.value }))}/></label><label><Label htmlFor="audit-type">{t('eventType')}</Label><Input id="audit-type" value={filters.type} onChange={(e) => setFilters((v) => ({ ...v, type: e.target.value }))}/></label><label><Label htmlFor="audit-reason">{t('reason')}</Label><Input id="audit-reason" value={filters.reason_code} onChange={(e) => setFilters((v) => ({ ...v, reason_code: e.target.value }))}/></label><label><Label htmlFor="audit-min">{t('amountMin')}</Label><Input id="audit-min" className="num" inputMode="numeric" value={filters.amount_min} onChange={(e) => setFilters((v) => ({ ...v, amount_min: e.target.value }))}/></label><label><Label htmlFor="audit-max">{t('amountMax')}</Label><Input id="audit-max" className="num" inputMode="numeric" value={filters.amount_max} onChange={(e) => setFilters((v) => ({ ...v, amount_max: e.target.value }))}/></label><div className="flex gap-2 sm:col-span-2 xl:col-span-4"><Button onClick={() => void loadCore()}>{t('applyFilters')}</Button><Button variant="outline" onClick={() => setFilters({ from: '', to: '', pos_session_id: '', user_id: '', type: '', reason_code: '', amount_min: '', amount_max: '' })}>{t('clearFilters')}</Button></div></div></details>{activity}</section>}
        {tab === 'carts' && <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{carts.length === 0 && !loading ? <p className="rounded border border-border bg-surface p-4 text-sm text-muted">{t('emptyCarts')}</p> : carts.map((cart) => <button key={cart.cart_id} onClick={() => void openCart(cart)} className="rounded border border-border bg-surface p-4 text-start transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><div className="flex items-start justify-between gap-3"><span className="text-sm font-medium text-text">{t('cartTimeline')}</span><span className="num text-xs text-muted">{t('cartEvents', { count: cart.event_count })}</span></div><p className="mt-4 text-sm text-text">{eventLabel(cart.last_event_type)}</p><p className="mt-1 text-xs text-muted">{t('lastEvent')}: {formatDate(cart.last_event_at, locale)}</p></button>)}</section>}
        {tab === 'cash' && <section className="space-y-3"><p className="text-sm text-muted">{t('cash')}</p><DataTable columns={eventColumns} data={events.filter((event) => ['cash_count', 'cash_movement', 'drawer'].includes(event.category ?? '') || event.type.includes('closing_') || event.type.includes('cash_'))} loading={loading} emptyLabel={t('emptyEvents')} mobileRecord={(row) => ({ title: eventLabel(row.type), subtitle: actorName(row), meta: [formatDate(row.created_at, locale)], actions: <button className="text-sm font-medium text-primary" onClick={() => setSelectedEvent(row)}>{t('viewDetails')}</button> })}/></section>}
        {tab === 'users' && <section className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">{users.map((activityUser) => <button key={activityUser.user_id} onClick={() => { setFilters((current) => ({ ...current, user_id: activityUser.user_id })); setTab('sensitive'); }} className="rounded border border-border bg-surface p-4 text-start transition-colors hover:border-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><UsersRound className="h-4 w-4 text-muted" strokeWidth={1.6} aria-hidden="true"/><p className="mt-4 text-sm font-medium text-text">{activityUser.name}</p><p className="num mt-1 text-xl font-semibold text-text">{activityUser.events_count}</p><p className="mt-1 text-xs text-muted">{formatDate(activityUser.last_event_at, locale)}</p></button>)}</section>}
        {tab === 'approvals' && <section className="space-y-3">{approvals.length === 0 ? <p className="rounded border border-border bg-surface p-4 text-sm text-muted">{t('emptyApprovals')}</p> : approvals.map((approval) => <article key={approval.id} className="flex flex-col gap-3 rounded border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between"><div><p className="text-sm font-medium text-text">{t('approvalRequest')} · {approval.operation}</p><p className="mt-1 text-xs text-muted">{t('requester')}: {approval.performed_by_user?.name ?? '—'} · {t('reason')}: {approval.reason_note ?? approval.reason_code ?? '—'}</p><p className="num mt-1 text-xs text-muted">{t('expires')}: {formatDate(approval.expires_at, locale)}</p></div>{approval.status === 'pending' && can('pos.override.approve') ? <Button onClick={() => void approve(approval.id)} disabled={approving === approval.id}><ShieldCheck className="h-4 w-4" strokeWidth={1.6}/>{approving === approval.id ? t('approving') : t('approve')}</Button> : <span className="text-sm text-muted">{approval.status}</span>}</article>)}</section>}
        {tab === 'settings' && <section className="space-y-4"><div className="rounded border border-border bg-surface p-4"><h2 className="text-base font-semibold text-text">{t('settings')}</h2><p className="mt-1 text-sm text-muted">{t('subtitle')}</p><Link href="/pos/settings/configuration" className="mt-3 inline-flex rounded px-1 py-1 text-sm font-medium text-primary underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">{t('settings')}</Link></div><div className="rounded border border-border bg-surface p-4"><h2 className="mb-3 text-base font-semibold text-text">{t('detectionRules')}</h2><RulesPanel canManage={can('pos.audit.settings.manage')} canRecalculate={can('pos.audit.recalculate')} /></div><div className="rounded border border-border bg-surface"><div className="border-b border-border p-3"><h2 className="text-base font-semibold text-text">{t('reason')}</h2></div><ul className="divide-y divide-border">{reasonCodes.map((reason) => <li key={reason.id} className="flex items-center justify-between gap-3 p-3"><div><p className="text-sm font-medium text-text">{locale === 'ar' ? reason.name_ar : reason.name_en}</p><p className="num mt-1 text-xs text-muted">{reason.code}{reason.requires_note ? ' · *' : ''}</p></div><span className="text-sm text-muted">{reason.is_active ? tc('active') : tc('inactive')}</span></li>)}</ul></div></section>}
      </TabPanel>

      <EventDetailDialog event={selectedEvent} onClose={() => setSelectedEvent(null)} />
      <Dialog open={cartTimeline !== null} onClose={() => setCartTimeline(null)} title={t('cartTimeline')}>
        {cartTimeline && (
          <div className="min-w-0 space-y-3">
            <details className="rounded border border-border bg-background">
              <summary className="cursor-pointer px-3 py-2 text-xs font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
                {t('technicalDetails')}
              </summary>
              <p className="num break-all border-t border-border px-3 py-2 text-xs text-muted" dir="ltr">{cartTimeline.cartId}</p>
            </details>
            <ol className="space-y-0 border-s border-border">
              {cartTimeline.events.map((event) => (
                <li key={event.id} className="relative ps-4 pb-4">
                  <span className="absolute -start-1.5 top-1.5 h-3 w-3 rounded-full border-2 border-surface bg-primary" aria-hidden="true" />
                  <button className="w-full text-start focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40" onClick={() => setSelectedEvent(event)}>
                    <p className="text-sm font-medium text-text">{eventLabel(event.type)}</p>
                    <p className="mt-1 text-xs text-muted">{formatDate(event.created_at, locale)} · {actorName(event)}</p>
                  </button>
                </li>
              ))}
            </ol>
          </div>
        )}
      </Dialog>
    </main>
  );
}
