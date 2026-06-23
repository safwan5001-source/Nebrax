'use client';

import { useEffect, useState } from 'react';
import { useTranslations } from 'next-intl';
import { Dialog } from '@/components/ui/dialog';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { Table, THead, TBody, TR, TH, TD } from '@/components/ui/table';
import { api, ApiError } from '@/lib/api';
import { formatRiyal } from '@/lib/money';

interface Item {
  id: string;
  employee?: { id: string; name: string } | null;
  basic_salary: string;
  allowances: string;
  gross: string;
  net: string;
}
export interface PayrollRun {
  id: string;
  number: string;
  period: string;
  status: string;
  pay_method?: string | null;
  total_gross: string;
  total_net: string;
  items?: Item[];
}

const statusTone: Record<string, 'positive' | 'warning' | 'muted'> = {
  paid: 'positive',
  posted: 'warning',
  draft: 'muted',
};

export function RunDetailDialog({
  runId,
  onClose,
  onChanged,
}: {
  runId: string | null;
  onClose: () => void;
  onChanged: () => void;
}) {
  const t = useTranslations('hr');
  const ts = useTranslations('status');
  const [run, setRun] = useState<PayrollRun | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!runId) {
      setRun(null);
      return;
    }
    setError(null);
    api<{ data: PayrollRun }>(`/payroll-runs/${runId}`).then((r) => setRun(r.data)).catch(() => {});
  }, [runId]);

  async function action(path: string, body?: unknown) {
    if (!run) return;
    setBusy(true);
    setError(null);
    try {
      const r = await api<{ data: PayrollRun }>(`/payroll-runs/${run.id}/${path}`, { method: 'POST', body });
      setRun(r.data);
      onChanged();
    } catch (err) {
      setError(err instanceof ApiError ? err.message : 'تعذّرت العملية');
    } finally {
      setBusy(false);
    }
  }

  if (!runId || !run) return null;

  return (
    <Dialog open={!!runId} onClose={onClose} title={`${t('run')} ${run.number}`} className="max-w-2xl">
      <div className="space-y-4">
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <span className="num text-muted">{run.period}</span>
          <Badge tone={statusTone[run.status] ?? 'muted'}>{ts(run.status)}</Badge>
          {run.pay_method && <Badge tone="muted">{t(run.pay_method === 'cash' ? 'cash' : 'bank')}</Badge>}
        </div>

        <div className="max-h-72 overflow-auto rounded border border-border">
          <Table>
            <THead>
              <TR>
                <TH>{t('emp_name')}</TH>
                <TH className="text-end">{t('basic_salary')}</TH>
                <TH className="text-end">{t('allowances')}</TH>
                <TH className="text-end">{t('net')}</TH>
              </TR>
            </THead>
            <TBody>
              {(run.items ?? []).map((it) => (
                <TR key={it.id}>
                  <TD>{it.employee?.name ?? '—'}</TD>
                  <TD className="num text-end">{formatRiyal(it.basic_salary)}</TD>
                  <TD className="num text-end">{formatRiyal(it.allowances)}</TD>
                  <TD className="num text-end font-medium">{formatRiyal(it.net)}</TD>
                </TR>
              ))}
            </TBody>
          </Table>
        </div>

        <div className="flex items-center justify-between border-t border-border pt-3">
          <span className="text-sm text-muted">{t('total_net')}</span>
          <span className="num text-lg font-bold text-text">{formatRiyal(run.total_net)}</span>
        </div>

        {error && <p className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}

        <div className="flex flex-wrap justify-end gap-2 pt-1">
          <Button variant="outline" onClick={onClose}>
            {t('close')}
          </Button>
          {run.status === 'draft' && (
            <Button disabled={busy} onClick={() => action('post')}>
              {t('post_accrual')}
            </Button>
          )}
          {run.status === 'posted' && (
            <>
              <Button variant="outline" disabled={busy} onClick={() => action('pay', { method: 'cash' })}>
                {t('pay_cash')}
              </Button>
              <Button disabled={busy} onClick={() => action('pay', { method: 'bank' })}>
                {t('pay_bank')}
              </Button>
            </>
          )}
        </div>
      </div>
    </Dialog>
  );
}
