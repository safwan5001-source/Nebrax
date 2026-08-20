'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { ArrowRight, Copy, FileText, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { formatRiyal } from '@/lib/money';

interface ManualJournalLine {
  id: string;
  account_id: string;
  account_code?: string | null;
  account_name?: string | null;
  description?: string | null;
  debit: string;
  credit: string;
  partner_id?: string | null;
  cost_center_code?: string | null;
  cost_center_name?: string | null;
}
interface ManualJournal {
  id: string;
  number: string;
  entry_date: string;
  description?: string | null;
  status: string;
  journal_entry_id?: string | null;
  lines: ManualJournalLine[];
}

const statusTone: Record<string, 'positive' | 'muted' | 'negative'> = {
  draft: 'muted', posted: 'positive', reversed: 'negative',
};

export default function ManualJournalDetailsPage() {
  const t = useTranslations('manualJournals');
  const tc = useTranslations('common');
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [journal, setJournal] = useState<ManualJournal | null>(null);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState(false);
  const [reverseOpen, setReverseOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [reverseDate, setReverseDate] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    api<{ data: ManualJournal }>(`/manual-journals/${params.id}`)
      .then((response) => setJournal(response.data))
      .catch((err) => toastError(err instanceof ApiError ? err.message : t('loadFailed')))
      .finally(() => setLoading(false));
  }, [params.id, t, toastError]);

  useEffect(() => load(), [load]);

  const totals = useMemo(() => (journal?.lines ?? []).reduce((sum, line) => ({
    debit: sum.debit + Number(line.debit || 0), credit: sum.credit + Number(line.credit || 0),
  }), { debit: 0, credit: 0 }), [journal]);

  const post = async () => {
    if (!journal) return;
    setActing(true);
    try {
      await api(`/manual-journals/${journal.id}/post`, { method: 'POST' });
      success(t('postSuccess'));
      load();
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally { setActing(false); }
  };

  const duplicate = async () => {
    if (!journal) return;
    setActing(true);
    try {
      const response = await api<{ data: ManualJournal }>(`/manual-journals/${journal.id}/duplicate`, { method: 'POST' });
      success(t('duplicateSuccess'));
      router.push(`/manual-journals/new?edit=${response.data.id}`);
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally { setActing(false); }
  };

  const remove = async () => {
    if (!journal || !window.confirm(t('confirmDelete'))) return;
    setActing(true);
    try {
      await api(`/manual-journals/${journal.id}`, { method: 'DELETE' });
      success(t('deletedSuccess'));
      router.push('/manual-journals');
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally { setActing(false); }
  };

  const reverse = async () => {
    if (!journal || reason.trim().length < 3) return;
    setActing(true);
    try {
      await api(`/manual-journals/${journal.id}/reverse`, {
        method: 'POST', body: { reason: reason.trim(), entry_date: reverseDate || null },
      });
      setReverseOpen(false);
      success(t('reverseSuccess'));
      load();
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally { setActing(false); }
  };

  if (loading) return <div className="h-72 animate-pulse rounded-md bg-muted" />;
  if (!journal) return null;

  const isDraft = journal.status === 'draft';
  const isPosted = journal.status === 'posted';

  return (
    <div className="mx-auto max-w-7xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <Button variant="ghost" size="icon" onClick={() => router.push('/manual-journals')} aria-label={t('back')}><ArrowRight className="h-4 w-4" strokeWidth={1.7} /></Button>
          <div>
            <div className="flex flex-wrap items-center gap-2"><h1 className="num text-xl font-semibold text-text">{journal.number}</h1><Badge tone={statusTone[journal.status] ?? 'muted'}>{t(journal.status)}</Badge></div>
            <p className="mt-1 text-sm text-muted">{journal.entry_date} · {journal.description || t('noDescription')}</p>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button variant="outline" disabled={acting} onClick={duplicate}><Copy className="h-4 w-4" strokeWidth={1.7} />{t('duplicate')}</Button>
          {isDraft && <><Link href={`/manual-journals/new?edit=${journal.id}`}><Button variant="outline"><Pencil className="h-4 w-4" strokeWidth={1.7} />{t('edit')}</Button></Link><Button variant="outline" disabled={acting} onClick={remove}><Trash2 className="h-4 w-4 text-negative" strokeWidth={1.7} />{t('delete')}</Button><Button disabled={acting} onClick={post}>{acting ? t('saving') : t('post')}</Button></>}
          {isPosted && <Button variant="outline" disabled={acting} onClick={() => { setReason(''); setReverseDate(journal.entry_date); setReverseOpen(true); }}><RotateCcw className="h-4 w-4" strokeWidth={1.7} />{t('reverse')}</Button>}
        </div>
      </div>

      {isDraft && <p className="rounded-md bg-warning/10 px-3 py-2 text-sm text-warning">{t('draftPostHint')}</p>}
      {journal.status === 'reversed' && <p className="rounded-md bg-negative/10 px-3 py-2 text-sm text-negative">{t('reversedHint')}</p>}

      <Card>
        <CardHeader><CardTitle>{t('lines')}</CardTitle></CardHeader>
        <CardContent className="overflow-x-auto p-0">
          <table className="min-w-full text-sm">
            <thead className="border-y border-border bg-muted/40 text-muted"><tr><th className="px-4 py-3 text-start font-medium">{t('account')}</th><th className="px-4 py-3 text-start font-medium">{t('lineDescription')}</th><th className="px-4 py-3 text-start font-medium">{t('costCenter')}</th><th className="px-4 py-3 text-end font-medium">{t('debit')}</th><th className="px-4 py-3 text-end font-medium">{t('credit')}</th></tr></thead>
            <tbody>
              {journal.lines.map((line) => <tr key={line.id} className="border-b border-border last:border-0"><td className="px-4 py-3"><span className="num text-muted">{line.account_code}</span> {line.account_name}</td><td className="px-4 py-3 text-muted">{line.description || '—'}</td><td className="px-4 py-3 text-muted">{line.cost_center_name ? `${line.cost_center_code ?? ''} — ${line.cost_center_name}` : '—'}</td><td className="num px-4 py-3 text-end text-negative">{Number(line.debit) ? formatRiyal(line.debit) : '—'}</td><td className="num px-4 py-3 text-end text-positive">{Number(line.credit) ? formatRiyal(line.credit) : '—'}</td></tr>)}
            </tbody>
            <tfoot className="bg-muted/40 font-semibold text-text"><tr><td colSpan={3} className="px-4 py-3">{t('totals')}</td><td className="num px-4 py-3 text-end">{formatRiyal(totals.debit)}</td><td className="num px-4 py-3 text-end">{formatRiyal(totals.credit)}</td></tr></tfoot>
          </table>
        </CardContent>
      </Card>

      {journal.journal_entry_id && <Card><CardContent className="flex items-center gap-3 p-5"><FileText className="h-5 w-5 text-primary" strokeWidth={1.7} /><div><p className="font-medium text-text">{t('journalEntryCreated')}</p><p className="num text-sm text-muted">{journal.journal_entry_id}</p></div></CardContent></Card>}

      <Dialog open={reverseOpen} onClose={() => setReverseOpen(false)} title={t('reverseTitle')}>
        <div className="space-y-4">
          <p className="text-sm text-muted">{t('reverseDescription')}</p>
          <div className="space-y-1.5"><Label htmlFor="reverse-date">{t('entryDate')}</Label><Input id="reverse-date" type="date" dir="ltr" value={reverseDate} onChange={(event) => setReverseDate(event.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="reverse-reason">{t('reverseReason')}</Label><Input id="reverse-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder={t('reverseReasonPlaceholder')} /></div>
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setReverseOpen(false)}>{t('cancel')}</Button><Button disabled={acting || reason.trim().length < 3} onClick={reverse}>{acting ? t('saving') : t('confirmReverse')}</Button></div>
        </div>
      </Dialog>
    </div>
  );
}
