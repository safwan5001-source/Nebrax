'use client';
import { displayLocale } from '@/lib/formatting';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Download, Filter, RefreshCw } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Combobox, type ComboOption } from '@/components/ui/combobox';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ReportFilters, EMPTY_FILTERS, type ReportFilterState } from '@/components/reports/report-filters';
import { ReportMetricGrid, type ReportColumnCell } from '@/components/reports/report-workspace-ui';
import { ReportResultsTable } from '@/components/reports/report-results-table';
import { ReportPresentationModeControl, type ReportPresentationMode } from '@/components/reports/report-presentation-mode';
import { ReportRankedAnalytics, type ReportRankedAnalyticsRow } from '@/components/reports/report-ranked-analytics';
import { api } from '@/lib/api';
import { toCsv, downloadCsv } from '@/lib/export';
import { formatRiyal } from '@/lib/money';

const SCOPES = ['sales_invoice', 'purchase_invoice', 'customer', 'supplier', 'receipt', 'payment'] as const;
type ClassificationScope = (typeof SCOPES)[number];

interface Classification { id: string; name: string; is_active: boolean }
interface ReportRow { key: string | null; label: string | null; records: number; amount: string }
interface ReportTotals { records: number; amount: string; classified_records: number; unclassified_records: number }
interface ReportResponse { scope: ClassificationScope; data: ReportRow[]; totals: ReportTotals }
interface FilterState extends ReportFilterState { scope: ClassificationScope; classificationId: string }

const EMPTY_STATE: FilterState = { ...EMPTY_FILTERS, scope: 'sales_invoice', classificationId: '' };

function queryFor(filters: FilterState): string {
  const params = new URLSearchParams({ scope: filters.scope });
  if (filters.from) params.set('from', filters.from);
  if (filters.to) params.set('to', filters.to);
  filters.branchIds.forEach((id) => params.append('branch_id[]', id));
  if (filters.classificationId) params.set('classification_id', filters.classificationId);
  return `?${params.toString()}`;
}

export function ClassificationAnalyticsWorkspace() {
  const t = useTranslations('classificationAnalytics');
  const locale = useLocale();
  const [filters, setFilters] = useState<FilterState>(EMPTY_STATE);
  const [presentationMode, setPresentationMode] = useState<ReportPresentationMode>('summary');
  const [classifications, setClassifications] = useState<Classification[]>([]);
  const [report, setReport] = useState<ReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const reportRequestGeneration = useRef(0);
  const classificationRequestGeneration = useRef(0);

  const load = useCallback(() => {
    const generation = ++reportRequestGeneration.current;
    setReport(null);
    setFailed(false);
    setLoading(true);
    api<ReportResponse>(`/reports/classification-analytics${queryFor(filters)}`)
      .then((response) => {
        if (!response?.totals || !Array.isArray(response.data)) throw new Error('invalid-classification-analytics-response');
        if (generation !== reportRequestGeneration.current) return;
        setReport(response);
      })
      .catch(() => {
        if (generation === reportRequestGeneration.current) setFailed(true);
      })
      .finally(() => {
        if (generation === reportRequestGeneration.current) setLoading(false);
      });
  }, [filters]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const generation = ++classificationRequestGeneration.current;
    setClassifications([]);
    api<{ data: Classification[] }>(`/classifications?scope=${filters.scope}`)
      .then((response) => {
        if (generation !== classificationRequestGeneration.current) return;
        setClassifications(Array.isArray(response?.data) ? response.data.filter((item) => item.is_active) : []);
      })
      .catch(() => {
        if (generation === classificationRequestGeneration.current) setClassifications([]);
      });
  }, [filters.scope]);
  useEffect(() => setPresentationMode('summary'), [filters.scope]);

  const options = useMemo<ComboOption[]>(() => classifications.map((item) => ({ value: item.id, label: item.name })), [classifications]);
  const count = useMemo(() => new Intl.NumberFormat(displayLocale(locale)).format.bind(new Intl.NumberFormat(displayLocale(locale))), [locale]);
  const displayAmount = useCallback((amount: string) => formatRiyal(amount), []);

  const table = useMemo(() => {
    if (!report) return null;
    const columns: ReportColumnCell[] = [
      { label: t('classification') },
      { label: t('records'), align: 'end' },
      { label: t('amount'), align: 'end' },
    ];
    const rows = report.data.map((row) => [row.label ?? t('unclassified'), count(row.records), displayAmount(row.amount)]);
    return {
      columns,
      rows,
      totalRow: [t('total'), count(report.totals.records), displayAmount(report.totals.amount)],
    };
  }, [report, t, count, displayAmount]);

  const rankedRows = useMemo<ReportRankedAnalyticsRow[]>(() => (report?.data ?? []).map((row) => ({
    key: row.key,
    label: row.label,
    amount: row.amount,
  })), [report]);

  const coverage = useMemo(() => {
    if (!report || report.totals.records <= 0) return null;
    return Math.max(0, Math.min(1, report.totals.classified_records / report.totals.records));
  }, [report]);

  const metrics = useMemo(() => {
    if (!report) return [];
    return [
      { label: t('totalAmount'), value: displayAmount(report.totals.amount) },
      { label: t('totalRecords'), value: count(report.totals.records) },
      { label: t('classifiedRecords'), value: count(report.totals.classified_records) },
      { label: t('unclassifiedRecords'), value: count(report.totals.unclassified_records), tone: 'warning' as const },
    ];
  }, [report, t, displayAmount, count]);

  function setScope(scope: ClassificationScope) {
    setPresentationMode('summary');
    setClassifications([]);
    setReport(null);
    setFilters((current) => current.scope === scope ? current : { ...current, scope, classificationId: '' });
  }

  function exportCsv() {
    if (!table || !report) return;
    downloadCsv(`classification-analytics-${filters.scope}`, toCsv(table.columns.map((column) => column.label), [...table.rows, table.totalRow]));
  }

  return (
    <div className="space-y-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex items-center gap-3">
          <Button asChild variant="ghost" size="icon" aria-label={t('backToReports')}><Link href="/reports" className="inline-flex rounded focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40"><ArrowRight className="h-4 w-4 rtl:rotate-180" strokeWidth={1.7} /></Link></Button>
          <div><h1 className="text-xl font-semibold text-text">{t('title')}</h1><p className="mt-1 text-sm text-muted">{t('subtitle')}</p></div>
        </div>
        <Button variant="outline" onClick={exportCsv} disabled={!report || report.data.length === 0}><Download className="h-4 w-4" strokeWidth={1.7} />{t('exportCsv')}</Button>
      </header>

      <Card className="no-print">
        <CardContent className="space-y-4 p-4">
          <ReportFilters
            value={filters}
            onChange={(base) => setFilters((current) => ({ ...current, ...base }))}
            onClear={() => { setPresentationMode('summary'); setFilters(EMPTY_STATE); }}
          />
          <div className="grid gap-3 sm:grid-cols-2">
            <div className="space-y-1.5">
              <Label htmlFor="classification-scope"><span className="inline-flex items-center gap-2"><Filter className="h-3.5 w-3.5" strokeWidth={1.7} />{t('scope')}</span></Label>
              <Select id="classification-scope" value={filters.scope} onChange={(event) => setScope(event.target.value as ClassificationScope)}>
                {SCOPES.map((scope) => <option key={scope} value={scope}>{t(`scopes.${scope}`)}</option>)}
              </Select>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="classification-filter">{t('classification')}</Label>
              <Combobox
                id="classification-filter"
                value={filters.classificationId}
                onChange={(classificationId) => setFilters((current) => ({ ...current, classificationId }))}
                options={options}
                placeholder={t('allClassifications')}
                clearLabel={t('allClassifications')}
                searchPlaceholder={t('classification')}
                emptyText={t('allClassifications')}
                aria-label={t('classification')}
              />
            </div>
          </div>
        </CardContent>
      </Card>

      {loading && <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4"><Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-24" /><Skeleton className="h-60 sm:col-span-2 xl:col-span-4" /></div>}
      {failed && !loading && <Card><CardContent className="flex flex-wrap items-center justify-between gap-3 p-5"><p className="text-sm text-negative" role="alert">{t('loadFailed')}</p><Button variant="outline" onClick={load}><RefreshCw className="h-4 w-4" strokeWidth={1.7} />{t('retry')}</Button></CardContent></Card>}
      {!loading && !failed && report && <>
        <div className="no-print flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-sm font-semibold text-text">{t('presentation')}</h2>
          <ReportPresentationModeControl value={presentationMode} onChange={setPresentationMode} label={t('presentation')} summaryLabel={t('summary')} detailLabel={t('detail')} />
        </div>
        <ReportMetricGrid metrics={metrics} />

        {presentationMode === 'detail' ? (
          <Card data-testid="classification-detail-unavailable"><CardHeader><CardTitle>{t('detailUnavailableTitle')}</CardTitle></CardHeader><CardContent><p className="text-sm leading-6 text-muted">{t('detailUnavailableDescription')}</p></CardContent></Card>
        ) : (
          <>
            <Card className="no-print" data-testid="classification-coverage">
              <CardHeader className="space-y-1 pb-3"><CardTitle className="text-sm">{t('coverage.title')}</CardTitle><p className="text-xs leading-5 text-muted">{t('coverage.description')}</p></CardHeader>
              <CardContent className="space-y-3">
                <div className="h-2 overflow-hidden rounded bg-border/60" role="img" aria-label={t('coverage.barLabel', { classified: count(report.totals.classified_records), unclassified: count(report.totals.unclassified_records) })}>
                  <div className="flex h-full w-full"><div className="bg-primary" style={{ width: `${(coverage ?? 0) * 100}%` }} /><div className="bg-warning/70" style={{ width: `${(coverage === null ? 0 : 1 - coverage) * 100}%` }} /></div>
                </div>
                <div className="grid gap-2 text-xs sm:grid-cols-3">
                  <p className="text-muted">{t('coverage.classified', { n: count(report.totals.classified_records) })}</p>
                  <p className="text-muted">{t('coverage.unclassified', { n: count(report.totals.unclassified_records) })}</p>
                  <p className="num text-text">{t('coverage.percent', { value: coverage === null ? '—' : new Intl.NumberFormat(displayLocale(locale), { style: 'percent', maximumFractionDigits: 1 }).format(coverage) })}</p>
                </div>
              </CardContent>
            </Card>
            <ReportRankedAnalytics analyticsKey="classification-amount" rows={rankedRows} loading={loading} title={t('analytics.title')} description={t('analytics.description')} emptyLabel={t('analytics.empty')} unassignedLabel={t('unclassified')} color="var(--primary)" />
            <Card>
              <CardHeader><CardTitle>{t('summary')}</CardTitle></CardHeader>
              <CardContent>
                {!table || table.rows.length === 0 ? <p className="py-8 text-center text-sm text-muted">{t('empty')}</p> : <ReportResultsTable columns={table.columns} rows={table.rows} totalRow={table.totalRow} emptyText={t('empty')} primaryIndex={0} reportKey={`classification-analytics:${filters.scope}`} />}
              </CardContent>
            </Card>
          </>
        )}
      </>}
    </div>
  );
}
