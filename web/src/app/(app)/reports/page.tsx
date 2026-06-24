'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Printer, Download } from 'lucide-react';
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

type Tab = 'trial' | 'aging';

interface TrialRow { code: string; name: string; debit: string; credit: string }
interface TrialBalance { rows: TrialRow[]; total_debit: string; total_credit: string; balanced: boolean }
interface AgingRow { partner_id: string; name: string; b0_30: string; b31_60: string; b61_90: string; b90_plus: string; total: string }
interface Aging { type: string; as_of: string; rows: AgingRow[]; totals: Omit<AgingRow, 'partner_id' | 'name'> }

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

  const load = useCallback(() => {
    setLoading(true);
    if (tab === 'trial') {
      api<TrialBalance>('/reports/trial-balance').then(setTrial).finally(() => setLoading(false));
    } else {
      api<Aging>(`/reports/aging/${agingType}`).then(setAging).finally(() => setLoading(false));
    }
  }, [tab, agingType]);

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
  }, [tab, agingType, trial, aging, t]);

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
        <Button variant={tab === 'aging' ? 'primary' : 'outline'} size="sm" onClick={() => setTab('aging')}>
          {t('aging')}
        </Button>
      </div>

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
