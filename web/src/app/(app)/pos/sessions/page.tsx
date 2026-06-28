'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus, LockKeyhole } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { formatRiyal, riyalToMinor, isNegative } from '@/lib/money';
import { cn } from '@/lib/utils';

interface Session {
  id: string;
  number: string;
  status: string;
  opening_balance: string;
  closing_balance: string | null;
  expected_balance: string | null;
  difference: string | null;
  opened_at: string | null;
  closed_at: string | null;
}

export default function PosSessionsPage() {
  const t = useTranslations('posSessions');
  const tc = useTranslations('common');
  const { success } = useToast();
  const [data, setData] = useState<Session[]>([]);
  const [loading, setLoading] = useState(true);
  const [openDialog, setOpenDialog] = useState(false);
  const [closeId, setCloseId] = useState<string | null>(null);
  const [amount, setAmount] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api<{ data: Session[] }>('/pos-sessions').then((r) => setData(r.data)).finally(() => setLoading(false));
  }, []);
  useEffect(() => load(), [load]);

  const hasOpen = data.some((s) => s.status === 'open');

  async function submitOpen() {
    setBusy(true); setError(null);
    try {
      await api('/pos-sessions/open', { method: 'POST', body: { opening_balance: riyalToMinor(amount) } });
      success(tc('created')); setOpenDialog(false); setAmount(''); load();
    } catch (e) { setError(e instanceof ApiError ? e.message : tc('saveFailed')); } finally { setBusy(false); }
  }
  async function submitClose() {
    if (!closeId) return;
    setBusy(true); setError(null);
    try {
      await api(`/pos-sessions/${closeId}/close`, { method: 'POST', body: { closing_balance: riyalToMinor(amount) } });
      success(tc('updated')); setCloseId(null); setAmount(''); load();
    } catch (e) { setError(e instanceof ApiError ? e.message : tc('saveFailed')); } finally { setBusy(false); }
  }

  const columns = useMemo<ColumnDef<Session, unknown>[]>(
    () => [
      { accessorKey: 'number', header: t('number'), cell: ({ row }) => <span className="num">{row.original.number}</span> },
      { accessorKey: 'opened_at', header: t('opened_at'), cell: ({ row }) => <span className="num text-muted">{(row.original.opened_at ?? '').slice(0, 16).replace('T', ' ')}</span> },
      { accessorKey: 'opening_balance', header: t('opening_balance'), cell: ({ row }) => <div className="num text-end">{formatRiyal(row.original.opening_balance)}</div> },
      { accessorKey: 'expected_balance', header: t('expected'), cell: ({ row }) => <div className="num text-end">{row.original.expected_balance ? formatRiyal(row.original.expected_balance) : '—'}</div> },
      { accessorKey: 'closing_balance', header: t('closing_balance'), cell: ({ row }) => <div className="num text-end">{row.original.closing_balance ? formatRiyal(row.original.closing_balance) : '—'}</div> },
      {
        accessorKey: 'difference',
        header: t('difference'),
        cell: ({ row }) => row.original.difference === null ? <div className="text-end text-muted">—</div>
          : <div className={cn('num text-end', isNegative(row.original.difference) && 'text-negative')}>{formatRiyal(row.original.difference)}</div>,
      },
      { accessorKey: 'status', header: t('status'), cell: ({ row }) => <Badge tone={row.original.status === 'open' ? 'warning' : 'positive'}>{row.original.status === 'open' ? t('open_status') : t('closed_status')}</Badge> },
      {
        id: 'actions', header: '',
        cell: ({ row }) => row.original.status === 'open' ? (
          <Button variant="outline" size="sm" onClick={() => { setCloseId(row.original.id); setAmount(''); setError(null); }}>
            <LockKeyhole className="h-3.5 w-3.5" strokeWidth={1.7} />{t('close')}
          </Button>
        ) : null,
      },
    ],
    [t],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
        <Button disabled={hasOpen} onClick={() => { setOpenDialog(true); setAmount(''); setError(null); }}>
          <Plus className="h-4 w-4" strokeWidth={1.8} />{t('open')}
        </Button>
      </div>

      {!loading && !hasOpen && <p className="rounded border border-border bg-surface px-4 py-3 text-sm text-muted">{t('no_open')}</p>}

      <DataTable columns={columns} data={data} loading={loading} searchPlaceholder={t('search')} emptyLabel={t('empty')} exportName="pos-sessions" />

      <Dialog open={openDialog} onClose={() => setOpenDialog(false)} title={t('open_title')}>
        <form onSubmit={(e) => { e.preventDefault(); submitOpen(); }} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="ob">{t('opening_balance')}</Label>
            <Input id="ob" className="num text-end" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </div>
          {error && <p className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setOpenDialog(false)}>{t('cancel')}</Button>
            <Button type="submit" disabled={busy}>{t('save')}</Button>
          </div>
        </form>
      </Dialog>

      <Dialog open={!!closeId} onClose={() => setCloseId(null)} title={t('close_title')}>
        <form onSubmit={(e) => { e.preventDefault(); submitClose(); }} className="space-y-3">
          <div className="space-y-1.5">
            <Label htmlFor="cb">{t('counted')}</Label>
            <Input id="cb" className="num text-end" inputMode="decimal" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </div>
          {error && <p className="rounded bg-negative/10 px-3 py-2 text-xs text-negative">{error}</p>}
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" onClick={() => setCloseId(null)}>{t('cancel')}</Button>
            <Button type="submit" disabled={busy}>{t('close')}</Button>
          </div>
        </form>
      </Dialog>
    </div>
  );
}
