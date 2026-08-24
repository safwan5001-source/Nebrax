'use client';
import { displayLocale } from '@/lib/formatting';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Download, Filter, RefreshCw } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Combobox, type ComboOption } from '@/components/ui/combobox';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { ReportFilters, EMPTY_FILTERS, type ReportFilterState } from '@/components/reports/report-filters';
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
  const [classifications, setClassifications] = useState<Classification[]>([]);
  const [report, setReport] = useState<ReportResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    setFailed(false);
    api<ReportResponse>(`/reports/classification-analytics${queryFor(filters)}`)
      .then((response) => {
        if (!response?.totals || !Array.isArray(response.data)) throw new Error('invalid-classification-analytics-response');
        setReport(response);
      })
      .catch(() => setFailed(true))
      .finally(() => setLoading(false));
  }, [filters]);

  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    api<{ data: Classification[] }>(`/classifications?scope=${filters.scope}`)
      .then((response) => setClassifications(response.data.filter((item) => item.is_active)))
      .catch(() => setClassifications([]));
  }, [filters.scope]);

  const options = useMemo<ComboOption[]>(() => classifications.map((item) => ({ value: item.id, label: item.name })), [classifications]);
  const count = useMemo(() => new Intl.NumberFormat(displayLocale(locale)).format.bind(new Intl.NumberFormat(displayLocale(locale))), [locale]);
  const displayAmount = useCallback((amount: string) => formatRiyal(amount), []);

  function setScope(scope: ClassificationScope) {
    setFilters((current) => ({ ...current, scope, classificationId: '' }));
  }

  function exportCsv() {
    if (!report) return;
    const headers = [t('classification'), t('records'), t('amount')];
    const rows = report.data.map((row) => [row.label ?? t('unclassified'), String(row.records), displayAmount(row.amount)]);
    rows.push([t('totalAmount'), String(report.totals.records), displayAmount(report.totals.amount)]);
    downloadCsv(`classification-analytics-${filters.scope}`, toCsv(headers, rows));
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
            onClear={() => setFilters(EMPTY_STATE)}
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

      {loading && <div className="grid gap-4 md:grid-cols-3"><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-28" /><Skeleton className="h-72 md:col-span-3" /></div>}
      {failed && !loading && <Card><CardContent className="flex flex-wrap items-center justify-between gap-3 p-5"><p className="text-sm text-negative" role="alert">{t('loadFailed')}</p><Button variant="outline" onClick={load}><RefreshCw className="h-4 w-4" strokeWidth={1.7} />{t('retry')}</Button></CardContent></Card>}
      {!loading && !failed && report && <>
        <div className="grid gap-4 md:grid-cols-3">
          <Metric title={t('totalAmount')} value={displayAmount(report.totals.amount)} />
          <Metric title={t('classifiedRecords')} value={count(report.totals.classified_records)} />
          <Metric title={t('unclassifiedRecords')} value={count(report.totals.unclassified_records)} />
        </div>
        <Card>
          <CardHeader><CardTitle>{t(`scopes.${report.scope}`)}</CardTitle></CardHeader>
          <CardContent className="p-0">
            {report.data.length === 0 ? <p className="p-5 text-sm text-muted">{t('empty')}</p> : <div className="overflow-x-auto"><Table><THead><TR><TH>{t('classification')}</TH><TH className="text-end">{t('records')}</TH><TH className="text-end">{t('amount')}</TH></TR></THead><TBody>{report.data.map((row) => <TR key={row.key ?? 'unclassified'}><TD className="font-medium text-text">{row.label ?? t('unclassified')}</TD><TD className="text-end tabular-nums">{count(row.records)}</TD><TD className="text-end tabular-nums">{displayAmount(row.amount)}</TD></TR>)}</TBody></Table></div>}
          </CardContent>
        </Card>
      </>}
    </div>
  );
}

function Metric({ title, value }: { title: string; value: string }) {
  return <Card><CardContent className="p-4"><p className="text-sm text-muted">{title}</p><p className="mt-2 text-2xl font-semibold tabular-nums text-text">{value}</p></CardContent></Card>;
}
