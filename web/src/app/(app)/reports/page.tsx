'use client';

import { useCallback, useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { api } from '@/lib/api';
import { formatRiyal } from '@/lib/money';

type Tab = 'trial' | 'aging';

interface TrialRow { code: string; name: string; debit: string; credit: string }
interface TrialBalance { rows: TrialRow[]; total_debit: string; total_credit: string; balanced: boolean }
interface AgingRow { partner_id: string; name: string; b0_30: string; b31_60: string; b61_90: string; b90_plus: string; total: string }
interface Aging { type: string; as_of: string; rows: AgingRow[]; totals: Omit<AgingRow, 'partner_id' | 'name'> }

export default function ReportsPage() {
  const t = useTranslations('reports');
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

  return (
    <div className="space-y-4">
      <h1 className="text-xl font-semibold text-text">{t('title')}</h1>

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
    </div>
  );
}
