'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Download, Filter, RefreshCw } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Combobox, type ComboOption } from '@/components/ui/combobox';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, TBody, TD, TH, THead, TR } from '@/components/ui/table';
import { ReportMetricGrid, ReportMobileRows, ReportScreenHeader, type ReportColumnCell, type ReportMetric } from '@/components/reports/report-workspace-ui';
import { api } from '@/lib/api';
import { currentUser } from '@/lib/auth';
import { displayLocale } from '@/lib/formatting';
import { formatMillilitersAsLiters } from '@/lib/fuel-quantity';
import { fuelAlertRuleLabelKey } from '@/lib/fuel-readiness';
import {
  EMPTY_FUEL_REPORT_FILTERS,
  aviDecisionLabelKey,
  aviReasonLabelKey,
  fuelMovementLabelKey,
  type FuelReportFilters,
  type FuelReportKey,
  collectionRows,
  filtersForReport,
  hasObjectPayload,
  isFuelReportKey,
  labelFor,
  numberValue,
  objectRows,
  reportFiltersFromSearch,
  reportQuery,
  reportSearchParams,
  stringValue,
  supportedFilterNames,
} from '@/lib/fuel-reports';
import { formatMinorRiyal } from '@/lib/money';
import { downloadCsv, toCsv } from '@/lib/export';

type Entity = { id: string; name?: string | null; code?: string | null; number?: string | null };
type ReportRow = Record<string, unknown>;
type Station = Entity & { city?: string | null };

type ReportDefinition = { key: FuelReportKey; group: 'sales' | 'receiving' | 'customers' | 'avi' | 'maintenance' | 'safety' | 'alerts' };

const REPORTS: ReportDefinition[] = [
  { key: 'sales-station', group: 'sales' },
  { key: 'sales-fuel', group: 'sales' },
  { key: 'sales-customer', group: 'customers' },
  { key: 'shift-sales', group: 'sales' },
  { key: 'inventory', group: 'receiving' },
  { key: 'deliveries', group: 'receiving' },
  { key: 'avi', group: 'avi' },
  { key: 'maintenance', group: 'maintenance' },
  { key: 'safety', group: 'safety' },
  { key: 'alerts', group: 'alerts' },
];

function entityMap(rows: Entity[]): Map<string, string> {
  return new Map(rows.filter((row) => !!row.id && !!row.name).map((row) => [row.id, row.code ? `${row.name} · ${row.code}` : row.name as string]));
}

function localDate(value: unknown, locale: string): string {
  const raw = stringValue(value);
  if (!raw) return '—';
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? '—' : new Intl.DateTimeFormat(displayLocale(locale), { dateStyle: 'medium' }).format(date);
}

function scopeLabel(filters: FuelReportFilters, stationName: string, t: (key: string) => string): string {
  const range = filters.from || filters.to ? `${filters.from || '…'} ← ${filters.to || '…'}` : t('allPeriods');
  return `${stationName || t('allStations')} · ${range}`;
}

function reportKeyFromSearch(value: string | null): FuelReportKey {
  return isFuelReportKey(value) ? value : 'sales-station';
}

type ReportPresentation = { columns: ReportColumnCell[]; rows: string[][]; metrics: ReportMetric[] };

export default function FuelReportsPage() {
  const t = useTranslations('fuelReports');
  const locale = useLocale();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [permissions, setPermissions] = useState<string[]>(() => currentUser()?.permissions ?? []);
  const [permissionsReady, setPermissionsReady] = useState(false);
  const [reportKey, setReportKey] = useState<FuelReportKey>(() => reportKeyFromSearch(searchParams.get('report')));
  const [filters, setFilters] = useState<FuelReportFilters>(() => reportFiltersFromSearch(searchParams));
  const [report, setReport] = useState<unknown>(null);
  const [stations, setStations] = useState<Station[]>([]);
  const [products, setProducts] = useState<Entity[]>([]);
  const [customers, setCustomers] = useState<Entity[]>([]);
  const [suppliers, setSuppliers] = useState<Entity[]>([]);
  const [shifts, setShifts] = useState<Entity[]>([]);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const canView = permissions.includes('*') || permissions.includes('fuel.reports.view');
  const stationLabels = useMemo(() => entityMap(stations), [stations]);
  const productLabels = useMemo(() => entityMap(products), [products]);
  const customerLabels = useMemo(() => entityMap(customers), [customers]);
  const supplierLabels = useMemo(() => entityMap(suppliers), [suppliers]);
  const shiftLabels = useMemo(() => entityMap(shifts), [shifts]);
  const selectedStation = filters.stationId ? stationLabels.get(filters.stationId) ?? t('unavailableEntity') : '';
  const stationOptions = useMemo<ComboOption[]>(() => stations.map((station) => ({ value: station.id, label: station.name ?? t('unavailableEntity'), sub: station.code ?? undefined, hint: station.city ?? undefined })), [stations, t]);
  const activeFilterNames = supportedFilterNames(reportKey);

  useEffect(() => {
    const user = currentUser();
    if (user?.permissions) { setPermissions(user.permissions); setPermissionsReady(true); return; }
    api<{ user: { permissions?: string[] } }>('/me').then((response) => setPermissions(response.user.permissions ?? [])).catch(() => {}).finally(() => setPermissionsReady(true));
  }, []);

  useEffect(() => {
    setReportKey(reportKeyFromSearch(searchParams.get('report')));
    setFilters(reportFiltersFromSearch(searchParams));
  }, [searchParams]);

  useEffect(() => {
    if (!permissionsReady || !canView) return;
    let cancelled = false;
    Promise.allSettled([
      api<unknown>('/fuel-stations/stations'),
      api<unknown>('/fuel-stations/products'),
      api<unknown>('/partners?type=customer'),
      api<unknown>('/partners?type=supplier'),
      api<unknown>('/fuel-stations/shifts'),
    ]).then(([stationResult, productResult, customerResult, supplierResult, shiftResult]) => {
      if (cancelled) return;
      if (stationResult.status === 'fulfilled') setStations(collectionRows<Station>(stationResult.value));
      if (productResult.status === 'fulfilled') setProducts(collectionRows<Entity>(productResult.value));
      if (customerResult.status === 'fulfilled') setCustomers(collectionRows<Entity>(customerResult.value));
      if (supplierResult.status === 'fulfilled') setSuppliers(collectionRows<Entity>(supplierResult.value));
      if (shiftResult.status === 'fulfilled') setShifts(collectionRows<Entity>(shiftResult.value));
    });
    return () => { cancelled = true; };
  }, [canView, permissionsReady]);

  const load = useCallback(() => {
    if (!canView) { setLoading(false); setReport(null); return; }
    setLoading(true);
    setFailed(false);
    api<unknown>(reportQuery(reportKey, filtersForReport(reportKey, filters)))
      .then((response) => {
        const valid = reportKey === 'alerts' || reportKey === 'deliveries' ? Array.isArray(collectionRows(response)) : hasObjectPayload(response);
        if (!valid) throw new Error('invalid-fuel-report-response');
        setReport(response);
      })
      .catch(() => { setFailed(true); setReport(null); })
      .finally(() => setLoading(false));
  }, [canView, filters, reportKey]);

  useEffect(() => { if (permissionsReady) load(); }, [load, permissionsReady]);

  const setQueryState = useCallback((key: FuelReportKey, next: FuelReportFilters) => {
    router.replace(`/fuel-stations/reports?${reportSearchParams(key, filtersForReport(key, next)).toString()}`);
  }, [router]);

  const changeReport = (key: FuelReportKey) => setQueryState(key, filters);
  const changeFilter = (name: keyof FuelReportFilters, value: string) => setQueryState(reportKey, { ...filters, [name]: value });
  const resetFilters = () => setQueryState(reportKey, EMPTY_FUEL_REPORT_FILTERS);

  const data = hasObjectPayload(report) ? report.data : {};
  const rows = reportKey === 'alerts' || reportKey === 'deliveries' ? collectionRows<ReportRow>(report) : objectRows(report);

  const presentation = useMemo(() => buildPresentation({
    key: reportKey,
    rows,
    data,
    labels: { stations: stationLabels, products: productLabels, customers: customerLabels, suppliers: supplierLabels, shifts: shiftLabels },
    locale,
    t,
  }), [reportKey, rows, data, stationLabels, productLabels, customerLabels, supplierLabels, shiftLabels, locale, t]);

  const exportCsv = () => {
    if (!presentation.rows.length) return;
    downloadCsv(`fuel-report-${reportKey}`, toCsv(presentation.columns.map((column) => column.label), presentation.rows));
  };

  const filterControls = (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {activeFilterNames.includes('from') && <label className="grid gap-1.5 text-sm font-medium text-text"><span>{t('from')}</span><Input className="h-11 md:h-9" type="date" value={filters.from} onChange={(event) => changeFilter('from', event.target.value)} /></label>}
      {activeFilterNames.includes('to') && <label className="grid gap-1.5 text-sm font-medium text-text"><span>{t('to')}</span><Input className="h-11 md:h-9" type="date" min={filters.from || undefined} value={filters.to} onChange={(event) => changeFilter('to', event.target.value)} /></label>}
      {activeFilterNames.includes('stationId') && <label className="grid gap-1.5 text-sm font-medium text-text"><span>{t('station')}</span><Combobox className="[&_button]:h-11 md:[&_button]:h-9" value={filters.stationId} onChange={(value) => changeFilter('stationId', value)} options={stationOptions} placeholder={t('allStations')} searchPlaceholder={t('searchStations')} emptyText={t('noStations')} clearLabel={t('allStations')} aria-label={t('station')} /></label>}
      {activeFilterNames.includes('status') && <label className="grid gap-1.5 text-sm font-medium text-text"><span>{t('status')}</span><select value={filters.status} onChange={(event) => changeFilter('status', event.target.value)} className="h-11 rounded border border-border bg-surface px-3 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-primary/40 md:h-9"><option value="">{t('allStatuses')}</option>{statusOptions(reportKey, t).map((status) => <option key={status} value={status}>{t(`statuses.${status}`)}</option>)}</select></label>}
      {activeFilterNames.includes('severity') && <label className="grid gap-1.5 text-sm font-medium text-text"><span>{t('severity')}</span><select value={filters.severity} onChange={(event) => changeFilter('severity', event.target.value)} className="h-11 rounded border border-border bg-surface px-3 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-primary/40 md:h-9"><option value="">{t('allSeverities')}</option>{['critical', 'high', 'medium', 'low'].map((severity) => <option key={severity} value={severity}>{t(`severities.${severity}`)}</option>)}</select></label>}
    </div>
  );

  if (!permissionsReady || loading) return <div className="space-y-4" aria-busy="true"><Skeleton className="h-16 w-full" /><Skeleton className="h-10 w-full" /><Skeleton className="h-72 w-full" /></div>;
  if (!canView) return <Card><CardContent className="py-10"><p role="status" className="text-sm text-muted">{t('noPermission')}</p></CardContent></Card>;

  const scope = reportKey === 'alerts' ? t('alertsScope') : reportKey === 'deliveries' ? `${selectedStation || t('allStations')} · ${filters.status ? t(`statuses.${filters.status}`) : t('allStatuses')}` : scopeLabel(filters, selectedStation, t);

  return (
    <div className="space-y-5">
      <ReportScreenHeader title={t('title')} description={t('subtitle')} scope={scope} actions={[{ id: 'csv', label: t('exportCsv'), icon: Download, onSelect: exportCsv, disabled: !presentation.rows.length }, { id: 'refresh', label: t('refresh'), icon: RefreshCw, onSelect: load }]} actionsLabel={t('actions')} />

      <Card className="hidden md:block"><CardContent className="space-y-3 py-4"><div className="flex flex-wrap items-center justify-between gap-3"><div><p className="text-xs font-medium text-muted">{t('chooseReport')}</p><ReportChooser value={reportKey} onChange={changeReport} t={t} /></div><Button type="button" variant="ghost" size="sm" onClick={resetFilters}>{t('resetFilters')}</Button></div>{filterControls}</CardContent></Card>

      <div className="md:hidden"><Button type="button" variant="outline" className="h-11 w-full justify-between" onClick={() => setFiltersOpen(true)}><span className="flex items-center gap-2"><Filter className="h-4 w-4" strokeWidth={1.7} />{t('filters')}</span><span className="text-xs text-muted">{t(`reports.${reportKey}`)}</span></Button><Dialog open={filtersOpen} onClose={() => setFiltersOpen(false)} title={t('filters')} className="sm:max-w-lg"><div className="space-y-5"><div><p className="mb-2 text-xs font-medium text-muted">{t('chooseReport')}</p><ReportChooser value={reportKey} onChange={changeReport} t={t} /></div>{filterControls}<div className="flex gap-2"><Button type="button" variant="outline" className="h-11 flex-1" onClick={resetFilters}>{t('resetFilters')}</Button><Button type="button" className="h-11 flex-1" onClick={() => setFiltersOpen(false)}>{t('apply')}</Button></div></div></Dialog></div>

      {failed ? <Card><CardContent className="py-10 text-center"><p role="alert" className="text-sm text-negative">{t('loadFailed')}</p><Button className="mt-3" variant="outline" size="sm" onClick={load}>{t('retry')}</Button></CardContent></Card> : <>
        <ReportMetricGrid metrics={presentation.metrics} />
        <Card><CardHeader><CardTitle>{t('details')}</CardTitle></CardHeader><CardContent>{presentation.rows.length === 0 ? <p className="py-10 text-center text-sm text-muted">{t('empty')}</p> : <><ReportMobileRows columns={presentation.columns} rows={presentation.rows} emptyText={t('empty')} primaryIndex={0} /><Table className="hidden md:table"><THead><TR>{presentation.columns.map((column) => <TH key={column.label} className={column.align === 'end' ? 'text-end' : undefined}>{column.label}</TH>)}</TR></THead><TBody>{presentation.rows.map((row, index) => <TR key={`${row[0]}-${index}`}>{row.map((cell, cellIndex) => <TD key={cellIndex} className={presentation.columns[cellIndex]?.align === 'end' ? 'num text-end' : undefined}>{cell}</TD>)}</TR>)}</TBody></Table></>}</CardContent></Card>
      </>}
    </div>
  );
}

function ReportChooser({ value, onChange, t }: { value: FuelReportKey; onChange: (key: FuelReportKey) => void; t: (key: string) => string }) {
  return <select aria-label={t('chooseReport')} value={value} onChange={(event) => onChange(event.target.value as FuelReportKey)} className="mt-1 h-11 min-w-64 rounded border border-border bg-surface px-3 text-sm text-text outline-none focus-visible:ring-2 focus-visible:ring-primary/40 md:h-9">{REPORTS.map((report) => <option key={report.key} value={report.key}>{t(`groups.${report.group}`)} — {t(`reports.${report.key}`)}</option>)}</select>;
}

function statusOptions(key: FuelReportKey, t: (key: string) => string): string[] {
  if (key === 'alerts') return ['active', 'acknowledged', 'resolved'];
  if (key === 'deliveries') return ['draft', 'approved'];
  return [];
}

function buildPresentation({ key, rows, data, labels, locale, t }: { key: FuelReportKey; rows: ReportRow[]; data: Record<string, unknown>; labels: { stations: Map<string, string>; products: Map<string, string>; customers: Map<string, string>; suppliers: Map<string, string>; shifts: Map<string, string> }; locale: string; t: (key: string) => string }): ReportPresentation {
  const count = (value: unknown) => new Intl.NumberFormat(displayLocale(locale)).format(numberValue(value));
  const money = (value: unknown) => formatMinorRiyal(numberValue(value));
  const volume = (value: unknown) => formatMillilitersAsLiters(numberValue(value));
  const unavailable = t('unavailableEntity');
  const numericColumns = (labelsList: string[]) => labelsList.map((label) => ({ label, align: 'end' as const }));

  if (key === 'sales-station' || key === 'sales-fuel' || key === 'sales-customer' || key === 'shift-sales') {
    const labelMap = key === 'sales-station' ? labels.stations : key === 'sales-fuel' ? labels.products : key === 'sales-customer' ? labels.customers : labels.shifts;
    const title = key === 'sales-station' ? t('station') : key === 'sales-fuel' ? t('fuelProduct') : key === 'sales-customer' ? t('customer') : t('shift');
    const tableRows = rows.map((row) => [labelFor(row.dimension_id, labelMap, unavailable), count(row.sales_count), volume(row.quantity_milliliters), money(row.revenue_minor), money(row.cogs_minor), money(row.margin_minor)]);
    const totalRevenue = rows.reduce((sum, row) => sum + numberValue(row.revenue_minor), 0);
    const totalMargin = rows.reduce((sum, row) => sum + numberValue(row.margin_minor), 0);
    return { columns: [{ label: title }, ...numericColumns([t('salesCount'), t('quantity'), t('revenue'), t('cogs'), t('margin')])], rows: tableRows, metrics: [{ label: t('salesCount'), value: count(rows.reduce((sum, row) => sum + numberValue(row.sales_count), 0)) }, { label: t('quantity'), value: volume(rows.reduce((sum, row) => sum + numberValue(row.quantity_milliliters), 0)) }, { label: t('revenue'), value: money(totalRevenue) }, { label: t('margin'), value: money(totalMargin), tone: totalMargin < 0 ? 'negative' as const : 'positive' as const }] };
  }

  if (key === 'deliveries') {
    const tableRows = rows.map((row) => [localDate(row.received_at, locale), labelFor(row.station_id, labels.stations, unavailable), labelFor(row.supplier_id, labels.suppliers, unavailable), labelFor(row.fuel_product_id, labels.products, unavailable), volume(row.received_milliliters), money(row.received_total_cost_minor), t(`statuses.${stringValue(row.status) === 'approved' ? 'approved' : 'draft'}`)]);
    const received = rows.reduce((sum, row) => sum + numberValue(row.received_milliliters), 0);
    return { columns: [{ label: t('receivedAt') }, { label: t('station') }, { label: t('supplier') }, { label: t('fuelProduct') }, ...numericColumns([t('receivedQuantity'), t('cost')]), { label: t('status') }], rows: tableRows, metrics: [{ label: t('deliveriesCount'), value: count(rows.length) }, { label: t('receivedQuantity'), value: volume(received) }, { label: t('cost'), value: money(rows.reduce((sum, row) => sum + numberValue(row.received_total_cost_minor), 0)) }] };
  }

  if (key === 'inventory') {
    const tableRows = rows.map((row) => [t(`movement.${fuelMovementLabelKey(row.movement_type)}`), volume(row.quantity_milliliters), money(row.value_minor)]);
    return { columns: [{ label: t('movementType') }, ...numericColumns([t('quantity'), t('value')])], rows: tableRows, metrics: [{ label: t('quantity'), value: volume(rows.reduce((sum, row) => sum + numberValue(row.quantity_milliliters), 0)) }, { label: t('value'), value: money(rows.reduce((sum, row) => sum + numberValue(row.value_minor), 0)) }] };
  }

  if (key === 'avi') {
    const decisionRows = objectRows({ data }, 'decisions');
    const tableRows = decisionRows.map((row) => [t(`decisions.${aviDecisionLabelKey(row.decision)}`), t(`reasons.${aviReasonLabelKey(row.reason_code)}`), count(row.count)]);
    return { columns: [{ label: t('decision') }, { label: t('reason') }, { label: t('authorizations'), align: 'end' as const }], rows: tableRows, metrics: [{ label: t('authorizations'), value: count(decisionRows.reduce((sum, row) => sum + numberValue(row.count), 0)) }, { label: t('approved'), value: count(decisionRows.filter((row) => aviDecisionLabelKey(row.decision) === 'approved').reduce((sum, row) => sum + numberValue(row.count), 0)) }, { label: t('rejected'), value: count(decisionRows.filter((row) => aviDecisionLabelKey(row.decision) === 'denied').reduce((sum, row) => sum + numberValue(row.count), 0)), tone: 'warning' as const }, { label: t('suspicious'), value: count(data.suspicious_authorizations) }] };
  }

  if (key === 'maintenance') {
    const tableRows = rows.map((row) => [t(`statuses.${stringValue(row.status) || 'reported'}`), count(row.count), money(row.cost_minor), count(row.downtime_minutes)]);
    return { columns: [{ label: t('status') }, ...numericColumns([t('workOrders'), t('cost'), t('downtimeMinutes')])], rows: tableRows, metrics: [{ label: t('workOrders'), value: count(rows.reduce((sum, row) => sum + numberValue(row.count), 0)) }, { label: t('cost'), value: money(rows.reduce((sum, row) => sum + numberValue(row.cost_minor), 0)) }, { label: t('downtimeMinutes'), value: count(rows.reduce((sum, row) => sum + numberValue(row.downtime_minutes), 0)) }] };
  }

  if (key === 'safety') {
    const inspectionRows = objectRows({ data }, 'inspection_statuses');
    const tableRows = inspectionRows.map((row) => [t(`statuses.${stringValue(row.status) || 'scheduled'}`), count(row.count)]);
    return { columns: [{ label: t('inspectionStatus') }, { label: t('inspections'), align: 'end' as const }], rows: tableRows, metrics: [{ label: t('inspections'), value: count(inspectionRows.reduce((sum, row) => sum + numberValue(row.count), 0)) }, { label: t('openCorrectiveActions'), value: count(data.open_corrective_actions), tone: numberValue(data.open_corrective_actions) > 0 ? 'warning' as const : undefined }, { label: t('expiringPermits'), value: count(data.expiring_permits), tone: numberValue(data.expiring_permits) > 0 ? 'warning' as const : undefined }] };
  }

  if (key === 'alerts') {
    const tableRows = rows.map((row) => [t(`alerts.rules.${fuelAlertRuleLabelKey(stringValue(row.rule))}`), t(`severities.${stringValue(row.severity) || 'low'}`), t(`statuses.${stringValue(row.status) || 'active'}`), localDate(row.last_detected_at, locale)]);
    return { columns: [{ label: t('alert') }, { label: t('severity') }, { label: t('status') }, { label: t('lastDetected') }], rows: tableRows, metrics: [{ label: t('alertsCount'), value: count(rows.length) }, { label: t('critical'), value: count(rows.filter((row) => stringValue(row.severity) === 'critical').length), tone: 'negative' as const }, { label: t('active'), value: count(rows.filter((row) => stringValue(row.status) === 'active').length), tone: 'warning' as const }] };
  }

  return { columns: [], rows: [], metrics: [] };
}
