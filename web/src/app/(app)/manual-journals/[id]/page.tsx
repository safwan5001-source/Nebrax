'use client';

import { useCallback, useEffect, useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { Copy, FileText, Pencil, RotateCcw, Trash2 } from 'lucide-react';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent } from '@/components/ui/card';
import { Dialog } from '@/components/ui/dialog';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { useToast } from '@/components/ui/toast';
import { DetailPage, ErrorState, FormAlert, LoadingState, type PageAction } from '@/components/nebrax';
import { LedgerLinesTable } from '@/components/accounting/ledger-lines-table';
import { api, ApiError } from '@/lib/api';

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
  const [loadError, setLoadError] = useState<string | null>(null);
  const [acting, setActing] = useState(false);
  const [reverseOpen, setReverseOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [reverseDate, setReverseDate] = useState('');

  const load = useCallback(() => {
    setLoading(true);
    setLoadError(null);
    api<{ data: ManualJournal }>(`/manual-journals/${params.id}`)
      .then((response) => setJournal(response.data))
      .catch((err) => setLoadError(err instanceof ApiError ? err.message : t('loadFailed')))
      .finally(() => setLoading(false));
  }, [params.id, t]);

  useEffect(() => load(), [load]);

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

  if (loading) return <LoadingState rows={8} label={tc('loading')} />;
  // لا صفحة بيضاء صامتة: إمّا القيد أو خطأٌ بزرّ إعادة محاولة.
  if (!journal) return <ErrorState message={loadError ?? t('loadFailed')} onRetry={load} />;

  const isDraft = journal.status === 'draft';
  const isPosted = journal.status === 'posted';

  const actions: PageAction[] = [
    { key: 'duplicate', label: t('duplicate'), icon: Copy, onClick: duplicate, variant: 'outline', emphasis: 'secondary', disabled: acting },
    ...(isDraft ? [
      { key: 'edit', label: t('edit'), icon: Pencil, href: `/manual-journals/new?edit=${journal.id}`, variant: 'outline' as const, emphasis: 'secondary' as const },
      { key: 'delete', label: t('delete'), icon: Trash2, onClick: remove, variant: 'danger' as const, emphasis: 'secondary' as const, disabled: acting },
      { key: 'post', label: acting ? t('saving') : t('post'), onClick: post, variant: 'primary' as const, disabled: acting },
    ] : []),
    ...(isPosted ? [
      { key: 'reverse', label: t('reverse'), icon: RotateCcw, variant: 'outline' as const, emphasis: 'secondary' as const, disabled: acting,
        onClick: () => { setReason(''); setReverseDate(journal.entry_date); setReverseOpen(true); } },
    ] : []),
  ];

  return (
    <DetailPage
      backHref="/manual-journals"
      backLabel={t('back')}
      title={journal.number}
      badges={<Badge tone={statusTone[journal.status] ?? 'muted'}>{t(journal.status)}</Badge>}
      meta={<><span className="num">{journal.entry_date}</span> · {journal.description || t('noDescription')}</>}
      actions={actions}
      alert={
        isDraft ? <FormAlert tone="warning">{t('draftPostHint')}</FormAlert>
        : journal.status === 'reversed' ? <FormAlert>{t('reversedHint')}</FormAlert>
        : undefined
      }
      sections={[{
        id: 'lines',
        title: t('lines'),
        count: journal.lines.length,
        flush: true,
        content: (
          <LedgerLinesTable
            lines={journal.lines}
            showCostCenter
            labels={{
              account: t('account'),
              description: t('lineDescription'),
              costCenter: t('costCenter'),
              debit: t('debit'),
              credit: t('credit'),
              totals: t('totals'),
              unknownAccount: t('noDescription'),
            }}
          />
        ),
      }]}
    >
      {journal.journal_entry_id && <Card><CardContent className="flex items-center gap-3 p-5"><FileText className="h-5 w-5 shrink-0 text-primary" strokeWidth={1.7} /><div className="min-w-0"><p className="font-medium text-text">{t('journalEntryCreated')}</p><p className="num truncate text-sm text-muted">{journal.journal_entry_id}</p></div></CardContent></Card>}

      <Dialog open={reverseOpen} onClose={() => setReverseOpen(false)} title={t('reverseTitle')}>
        <div className="space-y-4">
          <p className="text-sm text-muted">{t('reverseDescription')}</p>
          <div className="space-y-1.5"><Label htmlFor="reverse-date">{t('entryDate')}</Label><Input id="reverse-date" type="date" dir="ltr" value={reverseDate} onChange={(event) => setReverseDate(event.target.value)} /></div>
          <div className="space-y-1.5"><Label htmlFor="reverse-reason">{t('reverseReason')}</Label><Input id="reverse-reason" value={reason} onChange={(event) => setReason(event.target.value)} placeholder={t('reverseReasonPlaceholder')} /></div>
          <div className="flex justify-end gap-2"><Button variant="outline" onClick={() => setReverseOpen(false)}>{t('cancel')}</Button><Button disabled={acting || reason.trim().length < 3} onClick={reverse}>{acting ? t('saving') : t('confirmReverse')}</Button></div>
        </div>
      </Dialog>
    </DetailPage>
  );
}
