'use client';

/**
 * أسلوب «دفتر التحليل»: التقرير على الشاشة يقدّم النطاق والنتيجة والصفوف القابلة
 * للمس أولاً؛ أما مستند A4 فمسار معاينة مستقل. تبقى الجداول الكثيفة لسطح المكتب.
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useLocale, useTranslations } from 'next-intl';
import { Printer, Download, FileText, Info, Share2 } from 'lucide-react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { ReportDocument, type ReportColumn } from '@/components/reports/report-document';
import { api } from '@/lib/api';
import { formatRiyal } from '@/lib/money';
import { useCompany } from '@/lib/company';
import { toCsv, downloadCsv } from '@/lib/export';
import { ReportFilters, filtersToQuery, EMPTY_FILTERS, type ReportFilterState } from '@/components/reports/report-filters';
import { useToast } from '@/components/ui/toast';
import { DocumentScaler } from '@/modules/documents/components/document-scaler';
import { printDocument } from '@/modules/documents/services/export';
import { createReportPdf, downloadReportPdf, shareReportPdf } from '@/modules/reports/services/report-pdf';
import { ReportMetricGrid, ReportScreenHeader, type ReportMetric } from '@/components/reports/report-workspace-ui';
import { CustomerAgingChart } from '@/components/reports/customer-aging-chart';
import { ReportResultsTable } from '@/components/reports/report-results-table';
import { reportCellToneFromValue } from '@/components/reports/report-data-table';
import { StructuredFinancialStatement, type FinancialStatementSection } from '@/components/reports/structured-financial-statement';

export type ReportTab = 'trial' | 'income' | 'balance' | 'costcenter' | 'aging';
type Tab = ReportTab;

const ALL_TABS: Tab[] = ['trial', 'income', 'balance', 'costcenter', 'aging'];

interface ReportsWorkspaceProps {
  initialTab?: Tab;
  allowedTabs?: Tab[];
  fixedAgingType?: 'receivable' | 'payable';
  heading?: string;
}

interface TrialRow { code: string; name: string; debit: string; credit: string }
interface TrialBalance { rows: TrialRow[]; total_debit: string; total_credit: string; balanced: boolean }
interface AgingRow { partner_id: string; name: string; b0_30: string; b31_60: string; b61_90: string; b90_plus: string; total: string }
interface Aging { type: string; as_of: string; rows: AgingRow[]; totals: Omit<AgingRow, 'partner_id' | 'name'> }
interface AmountRow { code: string; name: string; amount: string }
interface Unallocated { total_revenue: string; total_expense: string; net_income: string }
interface IncomeStatement {
  revenues: AmountRow[];
  expenses: AmountRow[];
  total_revenue: string;
  total_expense: string;
  net_income: string;
  /** يعود من الـ API **عند التصفية بفرع فقط** — ما لا يخصّ أي فرع. */
  unallocated?: Unallocated;
}
interface BalanceSheet {
  assets: AmountRow[];
  liabilities: AmountRow[];
  equity: AmountRow[];
  total_assets: string;
  total_liabilities: string;
  total_equity: string;
  net_income: string;
  total_equity_and_income: string;
  balanced: boolean;
}
interface CcRow { cost_center_id: string; code: string; name: string; revenue: string; expense: string; profit: string }
interface Profitability { rows: CcRow[]; total_revenue: string; total_expense: string; total_profit: string }

interface ReportDoc {
  title: string;
  asOf?: string | null;
  columns: ReportColumn[];
  rows: string[][];
  totalRow?: string[] | null;
  exportName: string;
}

export function ReportsWorkspace({
  initialTab = 'trial',
  allowedTabs = ALL_TABS,
  fixedAgingType,
  heading,
}: ReportsWorkspaceProps) {
  const t = useTranslations('reports');
  const tReport = useTranslations('reportDoc');
  const tPrint = useTranslations('documentPrint');
  const locale = useLocale();
  const company = useCompany();
  const { success, error: errorToast } = useToast();
  const [tab, setTab] = useState<Tab>(initialTab);
  const [agingType, setAgingType] = useState<'receivable' | 'payable'>(fixedAgingType ?? 'receivable');
  const [loading, setLoading] = useState(true);
  const [trial, setTrial] = useState<TrialBalance | null>(null);
  const [aging, setAging] = useState<Aging | null>(null);
  const [cc, setCc] = useState<Profitability | null>(null);
  const [income, setIncome] = useState<IncomeStatement | null>(null);
  const [balance, setBalance] = useState<BalanceSheet | null>(null);
  // مرشّحات مشتركة: مدى تاريخي + فروع (فارغة = كل الفروع مجمّعة).
  const [filters, setFilters] = useState<ReportFilterState>(EMPTY_FILTERS);
  const [busy, setBusy] = useState<null | 'pdf' | 'share'>(null);
  const [showPreview, setShowPreview] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    const q = filtersToQuery(filters);
    if (tab === 'trial') {
      api<TrialBalance>(`/reports/trial-balance${q}`).then(setTrial).finally(() => setLoading(false));
    } else if (tab === 'income') {
      api<IncomeStatement>(`/reports/income-statement${q}`).then(setIncome).finally(() => setLoading(false));
    } else if (tab === 'balance') {
      // الميزانية «حتى تاريخ»: الخادم يتجاهل `from` أصلاً، ولا نرسله كي لا
      // يوحي المرشّح بأثرٍ لا يقع.
      api<BalanceSheet>(`/reports/balance-sheet${filtersToQuery({ ...filters, from: '' })}`)
        .then(setBalance).finally(() => setLoading(false));
    } else if (tab === 'costcenter') {
      api<Profitability>(`/reports/cost-center-profitability${q}`).then(setCc).finally(() => setLoading(false));
    } else {
      // الأعمار تعتمد «حتى تاريخ» لا مدى — يُمرَّر الفرع فقط.
      api<Aging>(`/reports/aging/${agingType}${filtersToQuery({ ...filters, from: '', to: '' })}`)
        .then(setAging).finally(() => setLoading(false));
    }
  }, [tab, agingType, filters]);

  useEffect(() => load(), [load]);

  useEffect(() => {
    if (fixedAgingType) setAgingType(fixedAgingType);
  }, [fixedAgingType]);

  const incomeStatementSections = useMemo<FinancialStatementSection[]>(() => {
    if (!income) return [];
    return [
      {
        id: 'revenues',
        label: t('revenues'),
        rows: [
          ...(income.revenues.length > 0
            ? income.revenues.map((row) => ({ id: `revenue-${row.code}`, kind: 'detail' as const, code: row.code, label: row.name, amount: row.amount }))
            : [{ id: 'revenues-empty', kind: 'empty' as const, label: t('empty') }]),
          { id: 'total-revenue', kind: 'subtotal' as const, label: t('total_revenue'), amount: income.total_revenue, tone: 'positive' as const },
        ],
      },
      {
        id: 'expenses',
        label: t('expenses'),
        rows: [
          ...(income.expenses.length > 0
            ? income.expenses.map((row) => ({ id: `expense-${row.code}`, kind: 'detail' as const, code: row.code, label: row.name, amount: row.amount }))
            : [{ id: 'expenses-empty', kind: 'empty' as const, label: t('empty') }]),
          { id: 'total-expense', kind: 'subtotal' as const, label: t('total_expense'), amount: income.total_expense, tone: 'negative' as const },
        ],
      },
    ];
  }, [income, t]);

  const balanceSheetSections = useMemo<FinancialStatementSection[]>(() => {
    if (!balance) return [];
    const sectionRows = (id: string, rows: AmountRow[], totalId: string, totalLabel: string, totalAmount: string) => [
      ...(rows.length > 0
        ? rows.map((row) => ({ id: `${id}-${row.code}`, kind: 'detail' as const, code: row.code, label: row.name, amount: row.amount }))
        : [{ id: `${id}-empty`, kind: 'empty' as const, label: t('empty') }]),
      { id: totalId, kind: 'subtotal' as const, label: totalLabel, amount: totalAmount },
    ];

    return [
      { id: 'assets', label: t('assets'), rows: sectionRows('asset', balance.assets, 'total-assets', t('total_assets'), balance.total_assets) },
      { id: 'liabilities', label: t('liabilities'), rows: sectionRows('liability', balance.liabilities, 'total-liabilities', t('total_liabilities'), balance.total_liabilities) },
      {
        id: 'equity',
        label: t('equity'),
        rows: [
          ...(balance.equity.length > 0
            ? balance.equity.map((row) => ({ id: `equity-${row.code}`, kind: 'detail' as const, code: row.code, label: row.name, amount: row.amount }))
            : [{ id: 'equity-empty', kind: 'empty' as const, label: t('empty') }]),
          { id: 'net-income', kind: 'detail' as const, label: t('net_income'), amount: balance.net_income, level: 1 as const, tone: 'auto' as const },
          { id: 'equity-and-income', kind: 'subtotal' as const, label: t('equity_and_income'), amount: balance.total_equity_and_income },
        ],
      },
    ];
  }, [balance, t]);

  // وصف التقرير الحالي (أعمدة + صفوف) لاستخدامه في PDF و CSV معاً.
  const doc = useMemo<ReportDoc | null>(() => {
    if (tab === 'trial') {
      if (!trial) return null;
      return {
        title: t('trial_balance'),
        columns: [
          { label: t('code') },
          { label: t('account') },
          { label: t('debit'), align: 'end' },
          { label: t('credit'), align: 'end' },
        ],
        rows: trial.rows.map((r) => [r.code, r.name, formatRiyal(r.debit), formatRiyal(r.credit)]),
        totalRow: ['', t('total'), formatRiyal(trial.total_debit), formatRiyal(trial.total_credit)],
        exportName: 'trial-balance',
      };
    }
    if (tab === 'income') {
      if (!income) return null;
      // بند «غير موزَّع» جزء من المستند المصدَّر أيضاً — وإلا خرج ملفٌ لا يفسّر نفسه.
      const rows: string[][] = [
        ...income.revenues.map((r) => [t('revenues'), r.code, r.name, formatRiyal(r.amount)]),
        ...income.expenses.map((r) => [t('expenses'), r.code, r.name, formatRiyal(r.amount)]),
      ];
      if (income.unallocated) {
        rows.push([t('unallocated'), '', t('total_revenue'), formatRiyal(income.unallocated.total_revenue)]);
        rows.push([t('unallocated'), '', t('total_expense'), formatRiyal(income.unallocated.total_expense)]);
      }
      return {
        title: t('income_statement'),
        columns: [
          { label: t('item') },
          { label: t('code') },
          { label: t('account') },
          { label: t('amount'), align: 'end' },
        ],
        rows,
        totalRow: ['', '', t('net_income'), formatRiyal(income.net_income)],
        exportName: 'income-statement',
      };
    }
    if (tab === 'balance') {
      if (!balance) return null;
      const section = (label: string, rows: AmountRow[]) =>
        rows.map((r) => [label, r.code, r.name, formatRiyal(r.amount)]);
      return {
        title: t('balance_sheet'),
        columns: [
          { label: t('item') },
          { label: t('code') },
          { label: t('account') },
          { label: t('amount'), align: 'end' },
        ],
        rows: [
          ...section(t('assets'), balance.assets),
          ...section(t('liabilities'), balance.liabilities),
          ...section(t('equity'), balance.equity),
          [t('equity'), '', t('net_income'), formatRiyal(balance.net_income)],
        ],
        totalRow: ['', '', t('total_assets'), formatRiyal(balance.total_assets)],
        exportName: 'balance-sheet',
      };
    }
    if (tab === 'costcenter') {
      if (!cc) return null;
      return {
        title: t('cost_profit'),
        columns: [
          { label: t('code') },
          { label: t('center') },
          { label: t('revenue'), align: 'end' },
          { label: t('expense'), align: 'end' },
          { label: t('profit'), align: 'end', cellTone: reportCellToneFromValue },
        ],
        rows: cc.rows.map((r) => [r.code, r.name, formatRiyal(r.revenue), formatRiyal(r.expense), formatRiyal(r.profit)]),
        totalRow: ['', t('total'), formatRiyal(cc.total_revenue), formatRiyal(cc.total_expense), formatRiyal(cc.total_profit)],
        exportName: 'cost-center-profitability',
      };
    }
    if (!aging) return null;
    return {
      title: `${t('aging')} — ${t(agingType)}`,
      asOf: aging.as_of,
      columns: [
        { label: t('partner') },
        { label: t('b0_30'), align: 'end' },
        { label: t('b31_60'), align: 'end' },
        { label: t('b61_90'), align: 'end' },
        { label: t('b90_plus'), align: 'end' },
        { label: t('total'), align: 'end' },
      ],
      rows: aging.rows.map((r) => [
        r.name,
        formatRiyal(r.b0_30),
        formatRiyal(r.b31_60),
        formatRiyal(r.b61_90),
        formatRiyal(r.b90_plus),
        formatRiyal(r.total),
      ]),
      totalRow: [
        t('total'),
        formatRiyal(aging.totals.b0_30),
        formatRiyal(aging.totals.b31_60),
        formatRiyal(aging.totals.b61_90),
        formatRiyal(aging.totals.b90_plus),
        formatRiyal(aging.totals.total),
      ],
      exportName: `aging-${agingType}`,
    };
  }, [tab, agingType, trial, aging, cc, income, balance, t]);

  const agingRowHrefs = useMemo(() => aging?.rows.map((row) => row.partner_id ? `/partners/${row.partner_id}` : null), [aging]);

  function exportCsv() {
    if (!doc) return;
    const headers = doc.columns.map((c) => c.label);
    const rows = [...doc.rows, ...(doc.totalRow ? [doc.totalRow] : [])];
    downloadCsv(doc.exportName, toCsv(headers, rows));
  }

  async function createPdf() {
    if (!doc) throw new Error('Report unavailable');
    return createReportPdf({
      ...doc,
      company,
      labels: {
        asOf: tReport('as_of'),
        vatNumber: tReport('vat_number'),
        crNumber: tPrint('cr_number'),
        footer: tReport('footer'),
        empty: t('empty'),
      },
      locale,
    });
  }

  async function handleDownloadPdf() {
    if (!doc) return;
    setBusy('pdf');
    try {
      downloadReportPdf(await createPdf(), doc.exportName);
      success(tPrint('downloaded_ok'));
    } catch {
      errorToast(tPrint('export_failed'));
    } finally {
      setBusy(null);
    }
  }

  async function handleShare() {
    if (!doc) return;
    setBusy('share');
    try {
      const result = await shareReportPdf(await createPdf(), doc.exportName, doc.title);
      success(result === 'shared' ? tPrint('shared_ok') : tPrint('downloaded_ok'));
    } catch (error) {
      if ((error as Error)?.name !== 'AbortError') errorToast(tPrint('export_failed'));
    } finally {
      setBusy(null);
    }
  }

  const scope = useMemo(() => {
    const branchScope = filters.branchIds.length === 0
      ? t('all_branches')
      : t('branches_selected', { n: filters.branchIds.length });
    const periodScope = !filters.from && !filters.to
      ? t('all_periods')
      : [filters.from || '…', filters.to || '…'].join(' ← ');
    return `${branchScope} · ${periodScope}`;
  }, [filters.branchIds, filters.from, filters.to, t]);

  const metrics = useMemo<ReportMetric[]>(() => {
    if (tab === 'trial' && trial) return [
      { label: t('debit'), value: formatRiyal(trial.total_debit) },
      { label: t('credit'), value: formatRiyal(trial.total_credit) },
      { label: t('trial_balance'), value: trial.balanced ? t('balanced') : t('unbalanced'), tone: trial.balanced ? 'positive' : 'negative' },
    ];
    if (tab === 'income' && income) return [
      { label: t('net_income'), value: formatRiyal(income.net_income), tone: Number(income.net_income) < 0 ? 'negative' : 'positive' },
      { label: t('total_revenue'), value: formatRiyal(income.total_revenue), tone: 'positive' },
      { label: t('total_expense'), value: formatRiyal(income.total_expense), tone: 'negative' },
    ];
    if (tab === 'balance' && balance) return [
      { label: t('total_assets'), value: formatRiyal(balance.total_assets) },
      { label: t('total_liabilities'), value: formatRiyal(balance.total_liabilities) },
      { label: t('equity_and_income'), value: formatRiyal(balance.total_equity_and_income), tone: balance.balanced ? 'positive' : 'negative' },
    ];
    if (tab === 'costcenter' && cc) return [
      { label: t('profit'), value: formatRiyal(cc.total_profit), tone: Number(cc.total_profit) < 0 ? 'negative' : 'positive' },
      { label: t('revenue'), value: formatRiyal(cc.total_revenue), tone: 'positive' },
      { label: t('expense'), value: formatRiyal(cc.total_expense), tone: 'negative' },
    ];
    if (tab === 'aging' && aging) return [
      { label: t('total'), value: formatRiyal(aging.totals.total) },
      { label: t('b90_plus'), value: formatRiyal(aging.totals.b90_plus), tone: Number(aging.totals.b90_plus) > 0 ? 'warning' : undefined },
    ];
    return [];
  }, [aging, balance, cc, income, t, tab, trial]);

  const actions = [
    { id: 'csv', label: t('csv'), icon: Download, onSelect: exportCsv, disabled: !doc || !!busy },
    { id: 'pdf', label: busy === 'pdf' ? tPrint('generating') : t('pdf'), icon: Download, onSelect: () => void handleDownloadPdf(), disabled: !doc || !!busy, busy: busy === 'pdf' },
    { id: 'share', label: busy === 'share' ? tPrint('generating') : t('share_pdf'), icon: Share2, onSelect: () => void handleShare(), disabled: !doc || !!busy, busy: busy === 'share' },
    { id: 'print', label: t('print'), icon: Printer, onSelect: () => printDocument({ widthMm: 210, heightMm: 297 }), disabled: !doc || !!busy },
    { id: 'preview', label: t('preview'), icon: FileText, onSelect: () => setShowPreview((visible) => !visible), disabled: !doc },
  ];

  return (
    <div className="space-y-5">
      <ReportScreenHeader title={heading ?? t('title')} scope={scope} actions={actions} actionsLabel={t('report_actions')} />

      {allowedTabs.length > 1 && (
        <div className="no-print -mx-1 flex gap-1 overflow-x-auto px-1 pb-1 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
          {allowedTabs.includes('trial') && (
            <Button variant={tab === 'trial' ? 'primary' : 'outline'} size="sm" onClick={() => setTab('trial')}>
              {t('trial_balance')}
            </Button>
          )}
          {allowedTabs.includes('income') && (
            <Button variant={tab === 'income' ? 'primary' : 'outline'} size="sm" onClick={() => setTab('income')}>
              {t('income_statement')}
            </Button>
          )}
          {allowedTabs.includes('balance') && (
            <Button variant={tab === 'balance' ? 'primary' : 'outline'} size="sm" onClick={() => setTab('balance')}>
              {t('balance_sheet')}
            </Button>
          )}
          {allowedTabs.includes('costcenter') && (
            <Button variant={tab === 'costcenter' ? 'primary' : 'outline'} size="sm" onClick={() => setTab('costcenter')}>
              {t('cost_profit')}
            </Button>
          )}
          {allowedTabs.includes('aging') && (
            <Button variant={tab === 'aging' ? 'primary' : 'outline'} size="sm" onClick={() => setTab('aging')}>
              {t('aging')}
            </Button>
          )}
        </div>
      )}

      <ReportFilters value={filters} onChange={setFilters} />

      <ReportMetricGrid metrics={metrics} />

      {aging && agingType === 'receivable' && (
        <CustomerAgingChart
          totals={aging.totals}
          labels={{ title: t('aging'), b0_30: t('b0_30'), b31_60: t('b31_60'), b61_90: t('b61_90'), b90_plus: t('b90_plus'), total: t('total') }}
        />
      )}

      {tab === 'trial' ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>{t('trial_balance')}</CardTitle>
            {trial && (
              <Badge tone={trial.balanced ? 'positive' : 'negative'}>
                {trial.balanced ? t('balanced') : t('unbalanced')}
              </Badge>
            )}
          </CardHeader>
          <CardContent>
            {loading || !trial ? (
              <Skeleton className="h-40 w-full" />
            ) : (
              <ReportResultsTable
                columns={doc?.columns ?? []}
                rows={doc?.rows ?? []}
                totalRow={doc?.totalRow}
                emptyText={t('empty')}
                primaryIndex={1}
                secondaryIndex={0}
                reportKey={tab === 'trial' ? 'general:trial-balance' : 'general:cost-center-profitability'}
              />
            )}
          </CardContent>
        </Card>
      ) : tab === 'income' ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>{t('income_statement')}</CardTitle>
            {income && (
              <Badge tone={Number(income.net_income) >= 0 ? 'positive' : 'negative'}>
                {formatRiyal(income.net_income)}
              </Badge>
            )}
          </CardHeader>
          <CardContent>
            {loading || !income ? (
              <Skeleton className="h-40 w-full" />
            ) : (
              <StructuredFinancialStatement
                descriptionLabel={t('account')}
                amountLabel={t('amount')}
                sections={incomeStatementSections}
                grandTotal={{ id: 'net-income', kind: 'grand-total', label: t('net_income'), amount: income.net_income, tone: 'auto' }}
              />
            )}

            {/* عند التصفية بفرع: ما لا يخصّ أي فرع يُكشَف صراحةً، فلا تبدو
                قائمة الفرع ناقصةً بلا تفسير. لا يظهر في العرض المجمّع. */}
            {income?.unallocated && (
              <div className="mt-4 rounded border border-border bg-background p-3">
                <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-text">
                  <Info className="h-4 w-4 shrink-0 text-muted" strokeWidth={1.8} />
                  {t('unallocated')}
                </div>
                <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-sm sm:grid-cols-3">
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">{t('total_revenue')}</dt>
                    <dd className="num font-medium">{formatRiyal(income.unallocated.total_revenue)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">{t('total_expense')}</dt>
                    <dd className="num font-medium">{formatRiyal(income.unallocated.total_expense)}</dd>
                  </div>
                  <div className="flex justify-between gap-3">
                    <dt className="text-muted">{t('net_income')}</dt>
                    <dd className={'num font-medium ' + (Number(income.unallocated.net_income) < 0 ? 'text-negative' : '')}>
                      {formatRiyal(income.unallocated.net_income)}
                    </dd>
                  </div>
                </dl>
                <p className="mt-2 text-[11px] leading-relaxed text-muted">{t('unallocated_hint')}</p>
              </div>
            )}
          </CardContent>
        </Card>
      ) : tab === 'balance' ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>{t('balance_sheet')}</CardTitle>
            {balance && (
              <Badge tone={balance.balanced ? 'positive' : 'negative'}>
                {balance.balanced ? t('balanced') : t('unbalanced')}
              </Badge>
            )}
          </CardHeader>
          <CardContent>
            {loading || !balance ? (
              <Skeleton className="h-40 w-full" />
            ) : (
              <>
                <StructuredFinancialStatement
                  descriptionLabel={t('account')}
                  amountLabel={t('amount')}
                  sections={balanceSheetSections}
                  grandTotal={{ id: 'balance-total-assets', kind: 'grand-total', label: t('total_assets'), amount: balance.total_assets }}
                  equation={{ id: 'balance-equation', kind: 'equation', label: `${t('total_assets')} = ${t('total_liabilities')} + ${t('equity_and_income')}`, amount: balance.total_assets }}
                />
                <p className="mt-3 text-[11px] leading-relaxed text-muted">{t('as_of_hint')}</p>
              </>
            )}
          </CardContent>
        </Card>
      ) : tab === 'costcenter' ? (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>{t('cost_profit')}</CardTitle>
            {cc && (
              <Badge tone={Number(cc.total_profit) >= 0 ? 'positive' : 'negative'}>{formatRiyal(cc.total_profit)}</Badge>
            )}
          </CardHeader>
          <CardContent>
            {loading || !cc ? (
              <Skeleton className="h-40 w-full" />
            ) : (
              <ReportResultsTable
                columns={doc?.columns ?? []}
                rows={doc?.rows ?? []}
                totalRow={doc?.totalRow}
                emptyText={t('empty')}
                primaryIndex={1}
                secondaryIndex={0}
                reportKey="general:cost-center-profitability"
              />
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>{t('aging')}</CardTitle>
            {!fixedAgingType && (
              <div className="flex gap-1">
                <Button
                  variant={agingType === 'receivable' ? 'primary' : 'outline'}
                  size="sm"
                  onClick={() => setAgingType('receivable')}
                >
                  {t('receivable')}
                </Button>
                <Button
                  variant={agingType === 'payable' ? 'primary' : 'outline'}
                  size="sm"
                  onClick={() => setAgingType('payable')}
                >
                  {t('payable')}
                </Button>
              </div>
            )}
          </CardHeader>
          <CardContent>
            {loading || !aging ? (
              <Skeleton className="h-40 w-full" />
            ) : (
              <ReportResultsTable
                columns={doc?.columns ?? []}
                rows={doc?.rows ?? []}
                totalRow={doc?.totalRow}
                emptyText={t('empty')}
                primaryIndex={0}
                rowHrefs={agingRowHrefs}
                reportKey={`general:aging:${agingType}`}
              />
            )}
          </CardContent>
        </Card>
      )}

      {doc && showPreview && (
        <Card>
          <CardHeader className="no-print"><CardTitle>{t('preview')}</CardTitle></CardHeader>
          <CardContent className="print:p-0">
            <div className="rounded bg-background p-3 print:bg-transparent print:p-0 [&_.print-only]:block">
              <DocumentScaler>
                <ReportDocument
                  title={doc.title}
                  asOf={doc.asOf}
                  company={company}
                  columns={doc.columns}
                  rows={doc.rows}
                  totalRow={doc.totalRow}
                />
              </DocumentScaler>
            </div>
          </CardContent>
        </Card>
      )}
    </div>
  );
}
