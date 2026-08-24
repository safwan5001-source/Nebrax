'use client';
import { displayLocale } from '@/lib/formatting';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { Check, Eye, Play, Settings2 } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { BranchViewToggle } from '@/components/ui/branch-view-toggle';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/select';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { branchViewQuery, type BranchView } from '@/lib/branch-view';

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

interface FinanceSettings {
  financial_alerts_enabled: boolean;
}

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

export default function FinancialAlertsPage() {
  const t = useTranslations('financialAlerts');
  const tc = useTranslations('common');
  const locale = useLocale();
  const { success, error: toastError } = useToast();
  const [alerts, setAlerts] = useState<FinancialAlert[]>([]);
  const [loading, setLoading] = useState(true);
  const [loadFailed, setLoadFailed] = useState(false);
  const [running, setRunning] = useState(false);
  const [acknowledgingId, setAcknowledgingId] = useState<string | null>(null);
  const [view, setView] = useState<BranchView>('current');
  const [status, setStatus] = useState<'all' | FinancialAlert['status']>('all');
  const [severity, setSeverity] = useState<'all' | FinancialAlert['severity']>('all');
  const [enabled, setEnabled] = useState<boolean | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setLoadFailed(false);
    try {
      const [alertResponse, settingsResponse] = await Promise.all([
        api<{ data: FinancialAlert[] }>(`/financial-control-alerts${branchViewQuery(view)}`),
        api<{ data: FinanceSettings }>('/settings/finance'),
      ]);
      setAlerts(alertResponse.data);
      setEnabled(settingsResponse.data.financial_alerts_enabled);
    } catch (err) {
      setLoadFailed(true);
      toastError(err instanceof ApiError ? err.message : t('loadFailed'));
    } finally {
      setLoading(false);
    }
  }, [t, toastError, view]);

  useEffect(() => { load(); }, [load]);

  const filteredAlerts = useMemo(() => alerts.filter((alert) => (
    (status === 'all' || alert.status === status) && (severity === 'all' || alert.severity === severity)
  )), [alerts, severity, status]);

  const formatDate = useCallback((value?: string | null) => {
    if (!value) return '—';
    return new Intl.DateTimeFormat(displayLocale(locale), { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
  }, [locale]);

  async function acknowledge(alert: FinancialAlert) {
    setAcknowledgingId(alert.id);
    try {
      await api(`/financial-control-alerts/${alert.id}/acknowledge`, { method: 'POST' });
      success(t('acknowledgedSuccess'));
      await load();
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setAcknowledgingId(null);
    }
  }

  async function runCheck() {
    setRunning(true);
    try {
      await api('/financial-control-alerts/run-check', { method: 'POST' });
      success(t('runCheckSuccess'));
      await load();
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setRunning(false);
    }
  }

  const columns = useMemo<ColumnDef<FinancialAlert, unknown>[]>(() => [
    { accessorKey: 'title', header: t('titleColumn'), cell: ({ row }) => <div className="min-w-56 space-y-1"><p className="font-medium text-text">{row.original.title}</p><p className="line-clamp-2 text-sm text-muted">{row.original.description}</p></div> },
    { accessorKey: 'severity', header: t('severity'), cell: ({ row }) => <Badge tone={severityTone(row.original.severity)}>{t(row.original.severity)}</Badge> },
    { accessorKey: 'status', header: t('status'), cell: ({ row }) => <Badge tone={statusTone(row.original.status)}>{t(row.original.status)}</Badge> },
    { accessorKey: 'last_detected_at', header: t('lastDetected'), cell: ({ row }) => <span className="num text-sm text-muted">{formatDate(row.original.last_detected_at)}</span> },
    { id: 'source', header: t('source'), cell: ({ row }) => {
      const path = sourcePath(row.original.source_type, row.original.source_id);
      return path ? <Link href={path} className="inline-flex items-center gap-1 text-sm font-medium text-primary hover:underline"><Eye className="h-3.5 w-3.5" strokeWidth={1.7} />{t('viewSource')}</Link> : <span className="text-sm text-muted">{t('noSource')}</span>;
    } },
    { id: 'actions', header: t('actions'), cell: ({ row }) => row.original.status === 'active' ? <Button size="sm" variant="outline" disabled={acknowledgingId === row.original.id} onClick={() => acknowledge(row.original)}><Check className="h-3.5 w-3.5" strokeWidth={1.7} />{t('acknowledge')}</Button> : null },
  ], [acknowledgingId, formatDate, t]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div><h1 className="text-xl font-semibold text-text">{t('title')}</h1><p className="mt-1 max-w-3xl text-sm leading-6 text-muted">{t('subtitle')}</p></div>
        <div className="flex flex-wrap items-center gap-2"><Link href="/finance-settings/financial-alerts"><Button variant="outline"><Settings2 className="h-4 w-4" strokeWidth={1.7} />{t('configure')}</Button></Link><Button disabled={running || enabled === false} onClick={runCheck}><Play className="h-4 w-4" strokeWidth={1.7} />{running ? t('runningCheck') : t('runCheck')}</Button></div>
      </div>

      {enabled === false && <div className="flex flex-wrap items-center justify-between gap-3 rounded border border-warning/30 bg-warning/10 p-3 text-sm text-text"><p>{t('alertsDisabled')}</p><Link href="/finance-settings/financial-alerts" className="font-medium text-primary hover:underline">{t('configure')}</Link></div>}

      <div className="flex flex-wrap items-center gap-2" aria-label={t('status')}>
        <BranchViewToggle value={view} onChange={setView} />
        <Select value={status} onChange={(event) => setStatus(event.target.value as typeof status)} aria-label={t('status')} className="w-40"><option value="all">{t('allStatuses')}</option><option value="active">{t('active')}</option><option value="acknowledged">{t('acknowledged')}</option><option value="resolved">{t('resolved')}</option></Select>
        <Select value={severity} onChange={(event) => setSeverity(event.target.value as typeof severity)} aria-label={t('severity')} className="w-40"><option value="all">{t('allSeverities')}</option><option value="critical">{t('critical')}</option><option value="high">{t('high')}</option><option value="medium">{t('medium')}</option></Select>
        <span role="status" aria-atomic="true" className="ms-auto text-sm text-muted">{t('activeCount', { count: filteredAlerts.filter((alert) => alert.status === 'active').length })}</span>
      </div>

      {loadFailed && !loading ? <div className="rounded border border-negative/30 bg-negative/10 p-4"><p className="text-sm text-text">{t('loadFailed')}</p><Button className="mt-3" size="sm" variant="outline" onClick={load}>{t('retry')}</Button></div> : <DataTable columns={columns} data={filteredAlerts} loading={loading} searchPlaceholder={t('search')} emptyLabel={t('empty')} exportName="financial-control-alerts" />}
    </div>
  );
}
