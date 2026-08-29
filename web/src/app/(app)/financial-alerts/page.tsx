'use client';
import { formatDateTime } from '@/lib/formatting';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useRouter, useSearchParams } from 'next/navigation';
import { type ColumnDef } from '@tanstack/react-table';
import { Check, Eye, Play, Settings2 } from 'lucide-react';
import { AdvancedFilterDialog } from '@/components/data-explorer/advanced-filter-dialog';
import { DataTable } from '@/components/data-table';
import { ListToolbar, PageHeader, Pagination, type PageAction, type SortOption } from '@/components/nebrax';
import { Badge } from '@/components/ui/badge';
import { BranchViewToggle } from '@/components/ui/branch-view-toggle';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { branchViewQuery, type BranchView } from '@/lib/branch-view';
import type { ActiveFilter, DataExplorerState, FilterDefinition } from '@/lib/data-explorer/types';
import { parseExplorerState, removeFilter, replaceFilter, serializeExplorerState } from '@/lib/data-explorer/url-state';

interface FinancialAlert {
  id: string;
  rule: string;
  severity: 'critical' | 'high' | 'medium';
  status: 'active' | 'acknowledged' | 'resolved';
  title: string;
  description: string;
  source_type?: string | null;
  source_id?: string | null;
  last_detected_at?: string | null;
}

interface FinanceSettings { financial_alerts_enabled: boolean }

const sourcePath = (sourceType?: string | null, sourceId?: string | null): string | null => {
  if (!sourceType || !sourceId) return null;
  const name = sourceType.split('\\').pop();
  const paths: Record<string, string> = {
    Invoice: '/invoices', Purchase: '/purchases', Payment: '/payments', Expense: '/expenses',
    CreditNote: '/credit-notes', ReturnDocument: '/returns', Asset: '/assets', ManualJournal: '/manual-journals', JournalEntry: '/journal-entries',
  };
  return paths[name ?? ''] ? `${paths[name ?? '']}/${sourceId}` : null;
};

const severityTone = (severity: FinancialAlert['severity']) => severity === 'critical' ? 'negative' : severity === 'high' ? 'warning' : 'muted';
const statusTone = (status: FinancialAlert['status']) => status === 'active' ? 'negative' : status === 'acknowledged' ? 'warning' : 'positive';

function filterValue(filter?: ActiveFilter): string {
  if (!filter || Array.isArray(filter.value)) return '';
  return String(filter.value).trim();
}
function isEmptyFilter(filter: ActiveFilter): boolean {
  return Array.isArray(filter.value) ? filter.value.every((value) => String(value).trim() === '') : String(filter.value).trim() === '';
}

export default function FinancialAlertsPage() {
  const t = useTranslations('financialAlerts');
  const tc = useTranslations('common');
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const { success, error: toastError } = useToast();
  const [explorer, setExplorer] = useState<DataExplorerState>(() => {
    const parsed = parseExplorerState(new URLSearchParams(searchParams.toString()));
    return { ...parsed, perPage: parsed.perPage ?? 25, sort: parsed.sort ?? '-last_detected_at' };
  });
  const [searchInput, setSearchInput] = useState(explorer.search);
  const [advancedOpen, setAdvancedOpen] = useState(false);
  const [alerts, setAlerts] = useState<FinancialAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [running, setRunning] = useState(false);
  const [acknowledgingId, setAcknowledgingId] = useState<string | null>(null);
  const [view, setView] = useState<BranchView>('current');
  const [enabled, setEnabled] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    setLoading(true); setLoadFailed(false);
    try {
      const [alertResponse, settingsResponse] = await Promise.all([
        api<{ data: FinancialAlert[] }>(`/financial-control-alerts${branchViewQuery(view)}`),
        api<{ data: FinanceSettings }>('/settings/finance'),
      ]);
      setAlerts(alertResponse.data); setEnabled(settingsResponse.data.financial_alerts_enabled);
    } catch (err) {
      setLoadFailed(true); toastError(err instanceof ApiError ? err.message : t('loadFailed'));
    } finally { setLoading(false); }
  }, [t, toastError, view]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const timer = window.setTimeout(() => setExplorer((current) => current.search === searchInput ? current : { ...current, search: searchInput, page: 1 }), 300);
    return () => window.clearTimeout(timer);
  }, [searchInput]);
  useEffect(() => {
    const url = serializeExplorerState(explorer);
    router.replace(url.toString() ? `/financial-alerts?${url.toString()}` : '/financial-alerts', { scroll: false });
  }, [explorer, router]);

  const formatDate = useCallback((value?: string | null) => formatDateTime(value, locale), [locale]);

  async function acknowledge(alert: FinancialAlert) {
    setAcknowledgingId(alert.id);
    try { await api(`/financial-control-alerts/${alert.id}/acknowledge`, { method: 'POST' }); success(t('acknowledgedSuccess')); await load(); }
    catch (err) { toastError(err instanceof ApiError ? err.message : tc('saveFailed')); }
    finally { setAcknowledgingId(null); }
  }
  async function runCheck() {
    setRunning(true);
    try { await api('/financial-control-alerts/run-check', { method: 'POST' }); success(t('runCheckSuccess')); await load(); }
    catch (err) { toastError(err instanceof ApiError ? err.message : tc('saveFailed')); }
    finally { setRunning(false); }
  }

  const definitions = useMemo<FilterDefinition[]>(() => [
    { key: 'status', label: t('status'), kind: 'select', quick: true, options: ['active', 'acknowledged', 'resolved'].map((value) => ({ value, label: t(value) })) },
    { key: 'severity', label: t('severity'), kind: 'select', quick: true, options: ['critical', 'high', 'medium'].map((value) => ({ value, label: t(value) })) },
    { key: 'date_from', label: `${t('lastDetected')} ≥`, kind: 'date' },
    { key: 'date_to', label: `${t('lastDetected')} ≤`, kind: 'date' },
  ], [t]);
  const labelledFilters = useMemo(() => explorer.filters.map((filter) => ({ ...filter, label: definitions.find((definition) => definition.key === filter.key)?.label ?? filter.label })), [definitions, explorer.filters]);

  const filtered = useMemo(() => {
    const filters = new Map(explorer.filters.map((filter) => [filter.key, filter]));
    const query = explorer.search.trim().toLocaleLowerCase();
    const status = filterValue(filters.get('status'));
    const severity = filterValue(filters.get('severity'));
    const dateFrom = filterValue(filters.get('date_from'));
    const dateTo = filterValue(filters.get('date_to'));
    return alerts.filter((alert) => {
      if (query && ![alert.title, alert.description, alert.rule, alert.status, alert.severity, alert.source_type].filter(Boolean).join(' ').toLocaleLowerCase().includes(query)) return false;
      if (status && alert.status !== status) return false;
      if (severity && alert.severity !== severity) return false;
      const detected = alert.last_detected_at?.slice(0, 10) ?? '';
      if (dateFrom && (!detected || detected < dateFrom)) return false;
      if (dateTo && (!detected || detected > dateTo)) return false;
      return true;
    });
  }, [alerts, explorer.filters, explorer.search]);

  const sorted = useMemo(() => {
    const next = [...filtered];
    const sort = explorer.sort ?? '-last_detected_at'; const desc = sort.startsWith('-'); const key = sort.replace(/^-/, '');
    next.sort((left, right) => {
      let comparison = 0;
      if (key === 'title') comparison = left.title.localeCompare(right.title, 'ar');
      else if (key === 'severity') comparison = left.severity.localeCompare(right.severity);
      else if (key === 'status') comparison = left.status.localeCompare(right.status);
      else comparison = (left.last_detected_at ?? '').localeCompare(right.last_detected_at ?? '');
      return desc ? -comparison : comparison;
    });
    return next;
  }, [explorer.sort, filtered]);

  const perPage = explorer.perPage ?? 25; const totalPages = Math.max(1, Math.ceil(sorted.length / perPage)); const page = Math.min(explorer.page ?? 1, totalPages);
  const pageData = sorted.slice((page - 1) * perPage, page * perPage);
  function updateFilter(next: ActiveFilter) { setExplorer((current) => ({ ...current, page: 1, filters: isEmptyFilter(next) ? removeFilter(current.filters, next.key) : replaceFilter(current.filters, next) })); }

  const columns = useMemo<ColumnDef<FinancialAlert, unknown>[]>(() => [
    { accessorKey: 'title', header: t('titleColumn'), cell: ({ row }) => <div className="min-w-56 space-y-1"><p className="font-medium text-text">{row.original.title}</p><p className="line-clamp-2 text-sm text-muted">{row.original.description}</p></div> },
    { accessorKey: 'severity', header: t('severity'), cell: ({ row }) => <Badge tone={severityTone(row.original.severity)}>{t(row.original.severity)}</Badge> },
    { accessorKey: 'status', header: t('status'), cell: ({ row }) => <Badge tone={statusTone(row.original.status)}>{t(row.original.status)}</Badge> },
    { accessorKey: 'last_detected_at', header: t('lastDetected'), cell: ({ row }) => <span className="num text-sm text-muted">{formatDate(row.original.last_detected_at)}</span> },
    { id: 'source', header: t('source'), cell: ({ row }) => { const path = sourcePath(row.original.source_type, row.original.source_id); return path ? <Link href={path} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"><Eye className="h-3.5 w-3.5" strokeWidth={1.7} />{t('viewSource')}</Link> : <span className="text-sm text-muted">{t('noSource')}</span>; } },
    { id: 'actions', header: t('actions'), cell: ({ row }) => row.original.status === 'active' ? <Button size="sm" variant="outline" disabled={acknowledgingId === row.original.id} onClick={() => acknowledge(row.original)}><Check className="h-3.5 w-3.5" strokeWidth={1.7} />{t('acknowledge')}</Button> : null },
  ], [acknowledgingId, formatDate, t]);

  const sortOptions: SortOption[] = [
    { value: '-last_detected_at', label: `${t('lastDetected')} ↓` }, { value: 'last_detected_at', label: `${t('lastDetected')} ↑` },
    { value: 'title', label: t('titleColumn') }, { value: 'severity', label: t('severity') }, { value: 'status', label: t('status') },
  ];
  const headerActions: PageAction[] = [
    { key: 'configure', label: t('configure'), icon: Settings2, href: '/finance-settings/financial-alerts', variant: 'outline', emphasis: 'secondary' },
    { key: 'run', label: running ? t('runningCheck') : t('runCheck'), icon: Play, onClick: runCheck, disabled: running || enabled === false, variant: 'primary' },
  ];

  return <div className="space-y-4">
    <PageHeader title={t('title')} description={t('subtitle')} context={<><BranchViewToggle value={view} onChange={(next) => { setView(next); setExplorer((current) => ({ ...current, page: 1 })); }} /><span role="status" aria-atomic="true" className="text-sm text-muted">{t('activeCount', { count: alerts.filter((alert) => alert.status === 'active').length })}</span></>} actions={headerActions} />
    {enabled === false && <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-warning/30 bg-warning/10 p-3 text-sm text-text"><p>{t('alertsDisabled')}</p><Link href="/finance-settings/financial-alerts" className="font-medium text-primary hover:underline">{t('configure')}</Link></div>}
    <ListToolbar search={searchInput} searchPlaceholder={t('search')} searchLabel={t('title')} onSearchChange={setSearchInput} definitions={definitions} filters={labelledFilters} onFilterChange={updateFilter} onRemoveFilter={(key) => setExplorer((current) => ({ ...current, page: 1, filters: removeFilter(current.filters, key) }))} onClearFilters={() => setExplorer((current) => ({ ...current, page: 1, filters: [] }))} onOpenAdvanced={() => setAdvancedOpen(true)} sort={{ value: explorer.sort ?? '-last_detected_at', onChange: (value) => setExplorer((current) => ({ ...current, page: 1, sort: value })), options: sortOptions }} resultCount={sorted.length} totalCount={alerts.length} />
    {loadFailed && !loading ? <div className="rounded border border-negative/30 bg-negative/10 p-4"><p className="text-sm text-text">{t('loadFailed')}</p><Button className="mt-3" size="sm" variant="outline" onClick={load}>{t('retry')}</Button></div> : <DataTable columns={columns} data={pageData} loading={loading} emptyLabel={t('empty')} exportName="financial-control-alerts" showToolbar={false} mobileRecord={(alert) => ({ title: alert.title, subtitle: alert.description, badge: <Badge tone={severityTone(alert.severity)}>{t(alert.severity)}</Badge>, status: <Badge tone={statusTone(alert.status)}>{t(alert.status)}</Badge>, meta: formatDate(alert.last_detected_at), actions: alert.status === 'active' ? <Button size="sm" variant="outline" disabled={acknowledgingId === alert.id} onClick={() => acknowledge(alert)}><Check className="h-3.5 w-3.5" strokeWidth={1.7} />{t('acknowledge')}</Button> : undefined })} />}
    <Pagination page={page} lastPage={totalPages} perPage={perPage} total={sorted.length} disabled={loading} onPageChange={(next) => setExplorer((current) => ({ ...current, page: next }))} onPerPageChange={(next) => setExplorer((current) => ({ ...current, page: 1, perPage: next }))} />
    <AdvancedFilterDialog open={advancedOpen} onClose={() => setAdvancedOpen(false)} definitions={definitions} filters={labelledFilters} onApply={(filters) => setExplorer((current) => ({ ...current, page: 1, filters }))} />
  </div>;
}
