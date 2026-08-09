'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Printer, Download, Info } from 'lucide-react';
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

type Tab = 'trial' | 'income' | 'balance' | 'costcenter' | 'aging';

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

export default function ReportsPage() {
  const t = useTranslations('reports');
  const company = useCompany();
  const [tab, setTab] = useState<Tab>('trial');
  const [agingType, setAgingType] = useState<'receivable' | 'payable'>('receivable');
  const [loading, setLoading] = useState(true);
  const [trial, setTrial] = useState<TrialBalance | null>(null);
  const [aging, setAging] = useState<Aging | null>(null);
  const [cc, setCc] = useState<Profitability | null>(null);
  const [income, setIncome] = useState<IncomeStatement | null>(null);
  const [balance, setBalance] = useState<BalanceSheet | null>(null);
  // مرشّحات مشتركة: مدى تاريخي + فروع (فارغة = كل الفروع مجمّعة).
  const [filters, setFilters] = useState<ReportFilterState>(EMPTY_FILTERS);

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
          { label: t('profit'), align: 'end' },
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

  function exportCsv() {
    if (!doc) return;
    const headers = doc.columns.map((c) => c.label);
    const rows = [...doc.rows, ...(doc.totalRow ? [doc.totalRow] : [])];
    downloadCsv(doc.exportName, toCsv(headers, rows));
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
        <div className="flex gap-2">
          <Button variant="outline" size="sm" disabled={!doc} onClick={exportCsv}>
            <Download className="h-4 w-4" strokeWidth={1.7} />
            {t('csv')}
          </Button>
          <Button variant="outline" size="sm" disabled={!doc} onClick={() => window.print()}>
            <Printer className="h-4 w-4" strokeWidth={1.7} />
            {t('pdf')}
          </Button>
        </div>
      </div>

      <div className="flex gap-1">
        <Button variant={tab === 'trial' ? 'primary' : 'outline'} size="sm" onClick={() => setTab('trial')}>
          {t('trial_balance')}
        </Button>
        <Button variant={tab === 'income' ? 'primary' : 'outline'} size="sm" onClick={() => setTab('income')}>
          {t('income_statement')}
        </Button>
        <Button variant={tab === 'balance' ? 'primary' : 'outline'} size="sm" onClick={() => setTab('balance')}>
          {t('balance_sheet')}
        </Button>
        <Button variant={tab === 'costcenter' ? 'primary' : 'outline'} size="sm" onClick={() => setTab('costcenter')}>
          {t('cost_profit')}
        </Button>
        <Button variant={tab === 'aging' ? 'primary' : 'outline'} size="sm" onClick={() => setTab('aging')}>
          {t('aging')}
        </Button>
      </div>

      <ReportFilters value={filters} onChange={setFilters} />

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
              <Table>
                <THead>
                  <TR>
                    <TH>{t('code')}</TH>
                    <TH>{t('account')}</TH>
                    <TH className="text-end">{t('debit')}</TH>
                    <TH className="text-end">{t('credit')}</TH>
                  </TR>
                </THead>
                <TBody>
                  {trial.rows.map((r) => (
                    <TR key={r.code}>
                      <TD className="num">{r.code}</TD>
                      <TD>{r.name}</TD>
                      <TD className="num text-end">{r.debit !== '0.00' ? formatRiyal(r.debit) : '—'}</TD>
                      <TD className="num text-end">{r.credit !== '0.00' ? formatRiyal(r.credit) : '—'}</TD>
                    </TR>
                  ))}
                  <TR className="font-semibold">
                    <TD />
                    <TD>{t('total')}</TD>
                    <TD className="num text-end">{formatRiyal(trial.total_debit)}</TD>
                    <TD className="num text-end">{formatRiyal(trial.total_credit)}</TD>
                  </TR>
                </TBody>
              </Table>
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
              <Table>
                <THead>
                  <TR>
                    <TH>{t('code')}</TH>
                    <TH>{t('account')}</TH>
                    <TH className="text-end">{t('amount')}</TH>
                  </TR>
                </THead>
                <TBody>
                  <TR className="bg-background">
                    <TD colSpan={3} className="text-xs font-semibold text-muted">{t('revenues')}</TD>
                  </TR>
                  {income.revenues.length === 0 ? (
                    <TR><TD colSpan={3} className="py-4 text-center text-muted">{t('empty')}</TD></TR>
                  ) : (
                    income.revenues.map((r) => (
                      <TR key={`rev-${r.code}`}>
                        <TD className="num">{r.code}</TD>
                        <TD>{r.name}</TD>
                        <TD className="num text-end">{formatRiyal(r.amount)}</TD>
                      </TR>
                    ))
                  )}
                  <TR className="font-semibold">
                    <TD />
                    <TD>{t('total_revenue')}</TD>
                    <TD className="num text-end text-positive">{formatRiyal(income.total_revenue)}</TD>
                  </TR>

                  <TR className="bg-background">
                    <TD colSpan={3} className="text-xs font-semibold text-muted">{t('expenses')}</TD>
                  </TR>
                  {income.expenses.length === 0 ? (
                    <TR><TD colSpan={3} className="py-4 text-center text-muted">{t('empty')}</TD></TR>
                  ) : (
                    income.expenses.map((r) => (
                      <TR key={`exp-${r.code}`}>
                        <TD className="num">{r.code}</TD>
                        <TD>{r.name}</TD>
                        <TD className="num text-end">{formatRiyal(r.amount)}</TD>
                      </TR>
                    ))
                  )}
                  <TR className="font-semibold">
                    <TD />
                    <TD>{t('total_expense')}</TD>
                    <TD className="num text-end text-negative">{formatRiyal(income.total_expense)}</TD>
                  </TR>

                  <TR className="border-t-2 border-border font-semibold">
                    <TD />
                    <TD>{t('net_income')}</TD>
                    <TD className={'num text-end ' + (Number(income.net_income) < 0 ? 'text-negative' : 'text-positive')}>
                      {formatRiyal(income.net_income)}
                    </TD>
                  </TR>
                </TBody>
              </Table>
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
                <Table>
                  <THead>
                    <TR>
                      <TH>{t('code')}</TH>
                      <TH>{t('account')}</TH>
                      <TH className="text-end">{t('amount')}</TH>
                    </TR>
                  </THead>
                  <TBody>
                    <SheetSection label={t('assets')} rows={balance.assets} emptyLabel={t('empty')} />
                    <TR className="font-semibold">
                      <TD />
                      <TD>{t('total_assets')}</TD>
                      <TD className="num text-end">{formatRiyal(balance.total_assets)}</TD>
                    </TR>

                    <SheetSection label={t('liabilities')} rows={balance.liabilities} emptyLabel={t('empty')} />
                    <TR className="font-semibold">
                      <TD />
                      <TD>{t('total_liabilities')}</TD>
                      <TD className="num text-end">{formatRiyal(balance.total_liabilities)}</TD>
                    </TR>

                    <SheetSection label={t('equity')} rows={balance.equity} emptyLabel={t('empty')} />
                    <TR>
                      <TD />
                      <TD className="text-muted">{t('net_income')}</TD>
                      <TD className={'num text-end ' + (Number(balance.net_income) < 0 ? 'text-negative' : '')}>
                        {formatRiyal(balance.net_income)}
                      </TD>
                    </TR>
                    <TR className="font-semibold">
                      <TD />
                      <TD>{t('equity_and_income')}</TD>
                      <TD className="num text-end">{formatRiyal(balance.total_equity_and_income)}</TD>
                    </TR>

                    {/* المعادلة المحاسبية صريحة في السطر الأخير: أصول = خصوم + حقوق ملكية. */}
                    <TR className="border-t-2 border-border font-semibold">
                      <TD />
                      <TD>{`${t('total_assets')} = ${t('total_liabilities')} + ${t('equity_and_income')}`}</TD>
                      <TD className="num text-end">
                        {formatRiyal(balance.total_assets)}
                      </TD>
                    </TR>
                  </TBody>
                </Table>
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
              <Table>
                <THead>
                  <TR>
                    <TH>{t('code')}</TH>
                    <TH>{t('center')}</TH>
                    <TH className="text-end">{t('revenue')}</TH>
                    <TH className="text-end">{t('expense')}</TH>
                    <TH className="text-end">{t('profit')}</TH>
                  </TR>
                </THead>
                <TBody>
                  {cc.rows.length === 0 ? (
                    <TR><TD colSpan={5} className="py-8 text-center text-muted">{t('empty')}</TD></TR>
                  ) : (
                    cc.rows.map((r) => (
                      <TR key={r.cost_center_id}>
                        <TD className="num">{r.code}</TD>
                        <TD>{r.name}</TD>
                        <TD className="num text-end">{formatRiyal(r.revenue)}</TD>
                        <TD className="num text-end">{formatRiyal(r.expense)}</TD>
                        <TD className={'num text-end font-medium ' + (Number(r.profit) < 0 ? 'text-negative' : Number(r.profit) > 0 ? 'text-positive' : '')}>{formatRiyal(r.profit)}</TD>
                      </TR>
                    ))
                  )}
                  {cc.rows.length > 0 && (
                    <TR className="font-semibold">
                      <TD />
                      <TD>{t('total')}</TD>
                      <TD className="num text-end">{formatRiyal(cc.total_revenue)}</TD>
                      <TD className="num text-end">{formatRiyal(cc.total_expense)}</TD>
                      <TD className="num text-end">{formatRiyal(cc.total_profit)}</TD>
                    </TR>
                  )}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="flex flex-row items-center justify-between">
            <CardTitle>{t('aging')}</CardTitle>
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
          </CardHeader>
          <CardContent>
            {loading || !aging ? (
              <Skeleton className="h-40 w-full" />
            ) : (
              <Table>
                <THead>
                  <TR>
                    <TH>{t('partner')}</TH>
                    <TH className="text-end">{t('b0_30')}</TH>
                    <TH className="text-end">{t('b31_60')}</TH>
                    <TH className="text-end">{t('b61_90')}</TH>
                    <TH className="text-end">{t('b90_plus')}</TH>
                    <TH className="text-end">{t('total')}</TH>
                  </TR>
                </THead>
                <TBody>
                  {aging.rows.length === 0 ? (
                    <TR>
                      <TD colSpan={6} className="py-8 text-center text-muted">
                        {t('empty')}
                      </TD>
                    </TR>
                  ) : (
                    aging.rows.map((r) => (
                      <TR key={r.partner_id}>
                        <TD>{r.name}</TD>
                        <TD className="num text-end">{formatRiyal(r.b0_30)}</TD>
                        <TD className="num text-end">{formatRiyal(r.b31_60)}</TD>
                        <TD className="num text-end">{formatRiyal(r.b61_90)}</TD>
                        <TD className="num text-end">{formatRiyal(r.b90_plus)}</TD>
                        <TD className="num text-end font-medium">{formatRiyal(r.total)}</TD>
                      </TR>
                    ))
                  )}
                  {aging.rows.length > 0 && (
                    <TR className="font-semibold">
                      <TD>{t('total')}</TD>
                      <TD className="num text-end">{formatRiyal(aging.totals.b0_30)}</TD>
                      <TD className="num text-end">{formatRiyal(aging.totals.b31_60)}</TD>
                      <TD className="num text-end">{formatRiyal(aging.totals.b61_90)}</TD>
                      <TD className="num text-end">{formatRiyal(aging.totals.b90_plus)}</TD>
                      <TD className="num text-end">{formatRiyal(aging.totals.total)}</TD>
                    </TR>
                  )}
                </TBody>
              </Table>
            )}
          </CardContent>
        </Card>
      )}

      {/* مستند التقرير A4 — يظهر عند الطباعة / حفظ PDF فقط */}
      {doc && (
        <ReportDocument
          title={doc.title}
          asOf={doc.asOf}
          company={company}
          columns={doc.columns}
          rows={doc.rows}
          totalRow={doc.totalRow}
        />
      )}
    </div>
  );
}

/** قسم في الميزانية: ترويسة ملوّنة بخلفية خفيفة ثم صفوف حساباته. */
function SheetSection({ label, rows, emptyLabel }: { label: string; rows: AmountRow[]; emptyLabel: string }) {
  return (
    <>
      <TR className="bg-background">
        <TD colSpan={3} className="text-xs font-semibold text-muted">{label}</TD>
      </TR>
      {rows.length === 0 ? (
        <TR><TD colSpan={3} className="py-4 text-center text-muted">{emptyLabel}</TD></TR>
      ) : (
        rows.map((r) => (
          <TR key={`${label}-${r.code}`}>
            <TD className="num">{r.code}</TD>
            <TD>{r.name}</TD>
            <TD className="num text-end">{formatRiyal(r.amount)}</TD>
          </TR>
        ))
      )}
    </>
  );
}
