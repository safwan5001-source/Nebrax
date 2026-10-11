'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import Link from 'next/link';
import { ArrowRight, Download } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { Skeleton } from '@/components/ui/skeleton';
import { ReportFilters } from '@/components/reports/report-filters';
import { ReportResultsTable } from '@/components/reports/report-results-table';
import { ReportMetricGrid, ReportScreenHeader, type ReportMetric } from '@/components/reports/report-workspace-ui';
import { api, hasApiStatus } from '@/lib/api';
import { AUTH_SESSION_CHANGED_EVENT, currentUser, type AuthUser } from '@/lib/auth';
import {
  buildDeliveryChannelCsv,
  comparisonRows,
  deliveryChannelPath,
  pinnedPlatformLabel,
  platformFilterOptions,
  readDeliveryChannelReport,
  shownCreditNotes,
  shownFinancialMetrics,
  type DeliveryChannelCsvLabels,
  type DeliveryChannelFilters,
  type DeliveryChannelReport,
  type PlatformFilterOption,
  CSV_COLUMNS,
} from '@/lib/delivery-channel-report';
import { displayLocale, formatDate } from '@/lib/formatting';
import { downloadCsv } from '@/lib/export';
import { formatRiyal } from '@/lib/money';
import { hasPermission } from '@/lib/permissions';

type Phase = 'boot' | 'loading' | 'ready' | 'error' | 'forbidden' | 'incomplete';

const EMPTY_FILTERS: DeliveryChannelFilters = { from: '', to: '', branchIds: [], profileId: '' };

export function DeliveryChannelReportWorkspace() {
  const t = useTranslations('reports.deliveryChannel');
  const tr = useTranslations('reports');
  const locale = useLocale();
  const [filters, setFilters] = useState<DeliveryChannelFilters>(EMPTY_FILTERS);
  const [report, setReport] = useState<DeliveryChannelReport | null>(null);
  const [options, setOptions] = useState<PlatformFilterOption[]>([]);
  const [optionScope, setOptionScope] = useState<string | null>(null);
  const [phase, setPhase] = useState<Phase>('boot');
  const [user, setUser] = useState<AuthUser | null>(null);
  const [mounted, setMounted] = useState(false);
  const generation = useRef(0);
  const catalogGeneration = useRef(0);

  useEffect(() => {
    setUser(currentUser());
    setMounted(true);
    const onSession = () => {
      generation.current += 1;
      catalogGeneration.current += 1;
      setUser(currentUser());
      setReport(null);
      setOptions([]);
      setOptionScope(null);
      setPhase('loading');
    };
    window.addEventListener(AUTH_SESSION_CHANGED_EVENT, onSession);
    return () => window.removeEventListener(AUTH_SESSION_CHANGED_EVENT, onSession);
  }, []);

  const canView = mounted && hasPermission(user?.permissions, user?.role, 'reports.view');
  const canOpenInvoice = canView && hasPermission(user?.permissions, user?.role, 'invoices.view');
  const canOpenReturn = canView && hasPermission(user?.permissions, user?.role, 'returns.view');
  const tenantId = user?.tenant_id ?? '';
  const scopeKey = `${tenantId}|${filters.from}|${filters.to}|${filters.branchIds.join(',')}`;

  const load = useCallback(() => {
    const requestGeneration = ++generation.current;
    const requestTenant = currentUser()?.tenant_id ?? '';
    setPhase('loading');
    setReport(null);
    api<unknown>(deliveryChannelPath(filters))
      .then((payload) => {
        if (requestGeneration !== generation.current) return;
        if ((currentUser()?.tenant_id ?? '') !== requestTenant) return;
        const parsed = readDeliveryChannelReport(payload);
        if (!parsed) {
          setPhase('incomplete');
          return;
        }
        setReport(parsed);
        if (!filters.profileId) {
          setOptions(platformFilterOptions(parsed));
          setOptionScope(scopeKey);
        }
        setPhase('ready');
      })
      .catch((error: unknown) => {
        if (requestGeneration !== generation.current) return;
        if ((currentUser()?.tenant_id ?? '') !== requestTenant) return;
        setReport(null);
        setPhase(hasApiStatus(error, 403) ? 'forbidden' : 'error');
      });
  }, [filters, scopeKey]);

  useEffect(() => {
    if (!mounted) return;
    if (!canView) {
      setPhase('forbidden');
      setReport(null);
      return;
    }
    load();
  }, [mounted, canView, load]);

  useEffect(() => {
    if (!mounted || !canView || !filters.profileId || optionScope === scopeKey) return;
    const requestGeneration = ++catalogGeneration.current;
    const requestTenant = currentUser()?.tenant_id ?? '';
    const catalogFilters = { ...filters, profileId: '' };
    api<unknown>(deliveryChannelPath(catalogFilters))
      .then((payload) => {
        if (requestGeneration !== catalogGeneration.current) return;
        if ((currentUser()?.tenant_id ?? '') !== requestTenant) return;
        const parsed = readDeliveryChannelReport(payload);
        if (!parsed) return;
        setOptions(platformFilterOptions(parsed));
        setOptionScope(scopeKey);
      })
      .catch(() => {
        if (requestGeneration !== catalogGeneration.current) return;
      });
  }, [mounted, canView, filters, optionScope, scopeKey]);

  const countFormat = useMemo(() => new Intl.NumberFormat(displayLocale(locale)), [locale]);
  const metrics = useMemo<ReportMetric[]>(() => {
    if (!report) return [];
    return shownFinancialMetrics(report).map((metric) => ({
      label: t(`metrics.${metric.id}`),
      value: metric.kind === 'money' ? formatRiyal(String(metric.value)) : countFormat.format(Number(metric.value)),
      tone: metric.id === 'net_after_pos_returns' && String(metric.value).startsWith('-') ? 'negative' : undefined,
    }));
  }, [report, t, countFormat]);

  const creditNotes = report ? shownCreditNotes(report) : null;
  const platforms = report ? comparisonRows(report) : [];
  const visibleOptions = useMemo(() => {
    if (optionScope === scopeKey) return options;
    if (filters.profileId) return [{ id: filters.profileId, platformKey: filters.profileId }];
    return [];
  }, [optionScope, scopeKey, options, filters.profileId]);

  function exportCsv() {
    if (!report) return;
    downloadCsv('delivery-channel-sales', buildDeliveryChannelCsv(report, csvLabels(t)));
  }

  const scope = useMemo(() => {
    const branchScope = filters.branchIds.length === 0 ? tr('all_branches') : tr('branches_selected', { n: filters.branchIds.length });
    const periodScope = !filters.from && !filters.to ? tr('all_periods') : [filters.from || '…', filters.to || '…'].join(' ← ');
    const platform = visibleOptions.find((option) => option.id === filters.profileId);
    const platformScope = filters.profileId ? (platform?.platformKey ?? filters.profileId) : t('allPlatforms');
    return `${branchScope} · ${periodScope} · ${platformScope}`;
  }, [filters, tr, t, visibleOptions]);

  const showResult = phase === 'ready' && report !== null;

  return (
    <div className="space-y-4" data-testid="delivery-channel-report">
      <div className="space-y-3">
        <Link href="/reports/sales" className="no-print inline-flex items-center gap-1 text-sm font-medium text-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary/40">
          <ArrowRight className="h-4 w-4 rtl:rotate-180" strokeWidth={1.7} />
          {t('back')}
        </Link>
        <ReportScreenHeader
          title={t('title')}
          description={t('description')}
          scope={mounted ? scope : undefined}
          actions={[{ id: 'csv', label: t('exportCsv'), icon: Download, onSelect: exportCsv, disabled: !showResult }]}
          actionsLabel={tr('report_actions')}
        />
      </div>

      <p className="text-sm leading-6 text-muted">{t('caption')}</p>

      <ReportFilters
        value={{ from: filters.from, to: filters.to, branchIds: filters.branchIds }}
        onChange={(next) => setFilters((current) => ({ ...current, from: next.from, to: next.to, branchIds: next.branchIds }))}
        onClear={() => setFilters(EMPTY_FILTERS)}
      />

      <div className="no-print max-w-xs space-y-1.5">
        <Label htmlFor="delivery-platform-filter">{t('platform')}</Label>
        <Select
          id="delivery-platform-filter"
          data-testid="delivery-platform-filter"
          value={filters.profileId}
          onChange={(event) => setFilters((current) => ({ ...current, profileId: event.target.value }))}
          disabled={!canView}
        >
          <option value="">{t('allPlatforms')}</option>
          {visibleOptions.map((option) => (
            <option key={option.id} value={option.id}>{option.platformKey}</option>
          ))}
        </Select>
      </div>

      {(phase === 'boot' || phase === 'loading') && (
        <div data-testid="delivery-channel-loading" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => <Skeleton key={index} className="h-20 w-full" />)}
        </div>
      )}

      {phase === 'forbidden' && (
        <Card data-testid="delivery-channel-forbidden">
          <CardContent className="py-8 text-center">
            <p className="text-sm font-medium text-text">{t('forbidden')}</p>
            <p className="mt-1 text-sm text-muted">{t('forbiddenHint')}</p>
          </CardContent>
        </Card>
      )}

      {phase === 'error' && (
        <Card data-testid="delivery-channel-error">
          <CardContent className="py-8 text-center">
            <p className="text-sm text-negative">{t('loadFailed')}</p>
            <Button className="mt-3" variant="outline" size="sm" onClick={load}>{t('retry')}</Button>
          </CardContent>
        </Card>
      )}

      {phase === 'incomplete' && (
        <Card data-testid="delivery-channel-incomplete">
          <CardContent className="py-8 text-center">
            <p className="text-sm text-negative">{t('incomplete')}</p>
            <Button className="mt-3" variant="outline" size="sm" onClick={load}>{t('retry')}</Button>
          </CardContent>
        </Card>
      )}

      {showResult && creditNotes && (
        <>
          <div data-testid="delivery-channel-metrics">
            <ReportMetricGrid metrics={metrics} />
          </div>

          <Card data-testid="delivery-channel-credit-notes">
            <CardHeader className="flex flex-row items-center justify-between gap-3">
              <CardTitle>{t('creditNotesTitle')}</CardTitle>
              <Badge tone="neutral">{t('separateFromNet')}</Badge>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm leading-6 text-muted">{t('creditNotesHint')}</p>
              <dl className="grid gap-3 sm:grid-cols-2">
                <div className="rounded border border-border bg-surface px-3 py-2">
                  <dt className="text-xs font-medium text-muted">{t('metrics.credit_note_count')}</dt>
                  <dd className="num mt-1 text-sm font-semibold text-text">{countFormat.format(creditNotes.count)}</dd>
                </div>
                <div className="rounded border border-border bg-surface px-3 py-2">
                  <dt className="text-xs font-medium text-muted">{t('metrics.credit_note_total')}</dt>
                  <dd className="num mt-1 text-sm font-semibold text-text">{formatRiyal(creditNotes.total)}</dd>
                </div>
              </dl>
              <ReportResultsTable
                columns={creditColumns(t)}
                rows={report.credit_notes.rows.map((row) => [
                  row.number,
                  formatDate(row.note_date, locale),
                  row.source_invoice_number,
                  row.platform_key,
                  formatRiyal(row.total),
                ])}
                emptyText={t('emptyCreditNotes')}
                primaryIndex={0}
                secondaryIndex={1}
                rowHrefs={report.credit_notes.rows.map((row) => (canOpenInvoice ? `/credit-notes/${row.id}` : null))}
                reportKey="delivery-channel:credit-notes"
              />
            </CardContent>
          </Card>

          <p className="text-sm leading-6 text-muted" data-testid="delivery-channel-collection">
            {t('collectionCaption', {
              platform: formatRiyal(report.collection.platform_collected_total),
              merchant: formatRiyal(report.collection.merchant_collected_total),
              unclassified: formatRiyal(report.collection.unclassified_total),
            })}
          </p>
          <p className="text-xs leading-5 text-muted" data-testid="delivery-channel-exceptions">
            {t('exceptions', {
              context: countFormat.format(report.exceptions.context_branch_mismatch),
              partner: countFormat.format(report.exceptions.credit_note_partner_mismatch),
            })}
          </p>

          {report.summary.invoice_count === 0 && report.summary.returns_count === 0 && creditNotes.count === 0 && (
            <p role="status" className="text-sm text-muted" data-testid="delivery-channel-empty">{t('empty')}</p>
          )}

          <Card data-testid="delivery-channel-comparison">
            <CardHeader><CardTitle>{t('comparisonTitle')}</CardTitle></CardHeader>
            <CardContent>
              <ReportResultsTable
                columns={[
                  { label: t('columns.platformKey') },
                  { label: t('metrics.invoice_count'), align: 'end' },
                  { label: t('metrics.total'), align: 'end' },
                  { label: t('metrics.returns_total'), align: 'end' },
                  { label: t('metrics.net_after_pos_returns'), align: 'end' },
                ]}
                rows={platforms.map((row) => [
                  row.platformKey,
                  countFormat.format(row.invoiceCount),
                  formatRiyal(row.total),
                  formatRiyal(row.returnsTotal),
                  formatRiyal(row.netAfter),
                ])}
                emptyText={t('empty')}
                primaryIndex={0}
                reportKey="delivery-channel:platforms"
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>{t('invoicesTitle')}</CardTitle></CardHeader>
            <CardContent>
              <ReportResultsTable
                columns={invoiceColumns(t)}
                rows={report.invoices.map((row) => [
                  row.number,
                  formatDate(row.invoice_date, locale),
                  row.branch_name || '—',
                  row.platform_key,
                  pinnedPlatformLabel(row, locale) || '—',
                  collectionModeLabel(row.collection_mode, t),
                  row.external_order_reference || '—',
                  formatRiyal(row.gross_sales),
                  formatRiyal(row.discounts),
                  formatRiyal(row.shipping),
                  formatRiyal(row.adjustment),
                  formatRiyal(row.net_sales),
                  formatRiyal(row.vat),
                  formatRiyal(row.total),
                  row.pos_session_id || '—',
                ])}
                emptyText={t('empty')}
                primaryIndex={0}
                secondaryIndex={1}
                rowHrefs={report.invoices.map((row) => (canOpenInvoice ? `/invoices/${row.id}` : null))}
                reportKey="delivery-channel:invoices"
              />
            </CardContent>
          </Card>

          <Card>
            <CardHeader><CardTitle>{t('returnsTitle')}</CardTitle></CardHeader>
            <CardContent>
              <ReportResultsTable
                columns={[
                  { label: t('columns.number') },
                  { label: t('columns.returnDate') },
                  { label: t('columns.sourceInvoice') },
                  { label: t('columns.platformKey') },
                  { label: t('metrics.returns_subtotal'), align: 'end' },
                  { label: t('metrics.returns_vat'), align: 'end' },
                  { label: t('metrics.returns_total'), align: 'end' },
                ]}
                rows={report.returns.map((row) => [
                  row.number,
                  formatDate(row.return_date, locale),
                  row.source_invoice_number,
                  row.platform_key,
                  formatRiyal(row.subtotal),
                  formatRiyal(row.vat),
                  formatRiyal(row.total),
                ])}
                emptyText={t('empty')}
                primaryIndex={0}
                secondaryIndex={1}
                rowHrefs={report.returns.map((row) => (canOpenReturn ? `/returns/${row.id}` : null))}
                reportKey="delivery-channel:returns"
              />
            </CardContent>
          </Card>
        </>
      )}
    </div>
  );
}

function collectionModeLabel(mode: string, t: (key: string) => string): string {
  if (mode === 'platform_collected' || mode === 'merchant_collected') return t(`collectionModes.${mode}`);
  return mode;
}

function invoiceColumns(t: (key: string) => string) {
  return [
    { label: t('columns.number') },
    { label: t('columns.date') },
    { label: t('columns.branch') },
    { label: t('columns.platformKey') },
    { label: t('columns.displayName') },
    { label: t('columns.collectionMode') },
    { label: t('columns.externalReference') },
    { label: t('metrics.gross_sales'), align: 'end' as const },
    { label: t('metrics.discounts'), align: 'end' as const },
    { label: t('metrics.shipping'), align: 'end' as const },
    { label: t('metrics.adjustment'), align: 'end' as const },
    { label: t('metrics.net_sales'), align: 'end' as const },
    { label: t('metrics.vat'), align: 'end' as const },
    { label: t('metrics.total'), align: 'end' as const },
    { label: t('columns.session') },
  ];
}

function creditColumns(t: (key: string) => string) {
  return [
    { label: t('columns.number') },
    { label: t('columns.noteDate') },
    { label: t('columns.sourceInvoice') },
    { label: t('columns.platformKey') },
    { label: t('metrics.credit_note_total'), align: 'end' as const },
  ];
}

function csvLabels(t: (key: string) => string): DeliveryChannelCsvLabels {
  const columns = Object.fromEntries(CSV_COLUMNS.map((column) => [column, t(`csv.${column}`)])) as DeliveryChannelCsvLabels['columns'];
  return {
    columns,
    sections: {
      summary: t('csvSections.summary'),
      creditNotes: t('csvSections.creditNotes'),
      creditNotesNotSubtracted: t('csvSections.creditNotesNotSubtracted'),
      collection: t('csvSections.collection'),
      exceptions: t('csvSections.exceptions'),
      platform: t('csvSections.platform'),
      invoice: t('csvSections.invoice'),
      returnDocument: t('csvSections.returnDocument'),
      creditNote: t('csvSections.creditNote'),
    },
    names: {
      grossSales: t('metrics.gross_sales'),
      discounts: t('metrics.discounts'),
      shipping: t('metrics.shipping'),
      adjustment: t('metrics.adjustment'),
      netSales: t('metrics.net_sales'),
      vat: t('metrics.vat'),
      total: t('metrics.total'),
      invoiceCount: t('metrics.invoice_count'),
      returnsCount: t('metrics.returns_count'),
      returnsSubtotal: t('metrics.returns_subtotal'),
      returnsVat: t('metrics.returns_vat'),
      returnsTotal: t('metrics.returns_total'),
      netAfterReturns: t('metrics.net_after_pos_returns'),
      creditNoteCount: t('metrics.credit_note_count'),
      creditNoteTotal: t('metrics.credit_note_total'),
      platformCollected: t('metrics.platform_collected'),
      merchantCollected: t('metrics.merchant_collected'),
      unclassified: t('metrics.unclassified'),
      contextMismatch: t('metrics.context_mismatch'),
      partnerMismatch: t('metrics.partner_mismatch'),
    },
  };
}
