'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { Copy, Eye, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { BranchViewToggle } from '@/components/ui/branch-view-toggle';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { branchViewQuery, type BranchView } from '@/lib/branch-view';

interface ManualJournal {
  id: string;
  number: string;
  entry_date: string;
  description?: string | null;
  status: string;
  journal_entry_id?: string | null;
}

const statusTone: Record<string, 'positive' | 'muted' | 'negative'> = {
  draft: 'muted', posted: 'positive', reversed: 'negative',
};

export default function ManualJournalsPage() {
  const t = useTranslations('manualJournals');
  const tc = useTranslations('common');
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [data, setData] = useState<ManualJournal[]>([]);
  const [loading, setLoading] = useState(true);
  const [acting, setActing] = useState<string | null>(null);
  const [view, setView] = useState<BranchView>('current');

  const load = useCallback(() => {
    setLoading(true);
    api<{ data: ManualJournal[] }>(`/manual-journals${branchViewQuery(view)}`)
      .then((response) => setData(response.data))
      .catch((err) => toastError(err instanceof ApiError ? err.message : t('loadFailed')))
      .finally(() => setLoading(false));
  }, [t, toastError, view]);

  useEffect(() => load(), [load]);

  const duplicate = useCallback(async (id: string) => {
    setActing(id);
    try {
      const response = await api<{ data: ManualJournal }>(`/manual-journals/${id}/duplicate`, { method: 'POST' });
      success(t('duplicateSuccess'));
      router.push(`/manual-journals/new?edit=${response.data.id}`);
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally { setActing(null); }
  }, [router, success, t, tc, toastError]);

  const remove = useCallback(async (id: string) => {
    if (!window.confirm(t('confirmDelete'))) return;
    setActing(id);
    try {
      await api(`/manual-journals/${id}`, { method: 'DELETE' });
      success(t('deletedSuccess'));
      load();
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally { setActing(null); }
  }, [load, success, t, tc, toastError]);

  const columns = useMemo<ColumnDef<ManualJournal, unknown>[]>(() => [
    { accessorKey: 'number', header: t('number'), cell: ({ row }) => <Link href={`/manual-journals/${row.original.id}`} className="num font-medium text-primary hover:underline">{row.original.number}</Link> },
    { accessorKey: 'entry_date', header: t('entryDate'), cell: ({ row }) => <span className="num text-muted">{row.original.entry_date}</span> },
    { accessorKey: 'description', header: t('description'), cell: ({ row }) => row.original.description || '—' },
    { accessorKey: 'status', header: t('status'), cell: ({ row }) => <Badge tone={statusTone[row.original.status] ?? 'muted'}>{t(row.original.status)}</Badge> },
    { id: 'actions', header: t('actions'), cell: ({ row }) => {
      const journal = row.original;
      const busy = acting === journal.id;
      const isDraft = journal.status === 'draft';
      return <div className="flex justify-end gap-1"><Link href={`/manual-journals/${journal.id}`}><Button size="icon" variant="ghost" aria-label={t('view')}><Eye className="h-4 w-4" strokeWidth={1.7} /></Button></Link>{isDraft ? <Link href={`/manual-journals/new?edit=${journal.id}`}><Button size="icon" variant="ghost" aria-label={t('edit')}><Pencil className="h-4 w-4" strokeWidth={1.7} /></Button></Link> : <Button size="icon" variant="ghost" disabled title={t('draftOnly')} aria-label={t('edit')}><Pencil className="h-4 w-4" strokeWidth={1.7} /></Button>}<Button size="icon" variant="ghost" disabled={busy} onClick={() => duplicate(journal.id)} aria-label={t('duplicate')}><Copy className="h-4 w-4" strokeWidth={1.7} /></Button><Button size="icon" variant="ghost" disabled={!isDraft || busy} title={!isDraft ? t('draftOnly') : undefined} onClick={() => remove(journal.id)} aria-label={t('delete')}><Trash2 className="h-4 w-4 text-negative" strokeWidth={1.7} /></Button>{journal.status === 'posted' && <Link href={`/manual-journals/${journal.id}`}><Button size="icon" variant="ghost" aria-label={t('reverse')}><RotateCcw className="h-4 w-4" strokeWidth={1.7} /></Button></Link>}</div>;
    } },
  ], [acting, duplicate, remove, t]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-xl font-semibold text-text">{t('title')}</h1><p className="mt-1 text-sm text-muted">{t('subtitle')}</p></div>
        <div className="flex items-center gap-2"><BranchViewToggle value={view} onChange={setView} /><Link href="/manual-journals/new"><Button><Plus className="h-4 w-4" strokeWidth={1.8} />{t('create')}</Button></Link></div>
      </div>
      <DataTable columns={columns} data={data} loading={loading} searchPlaceholder={t('search')} emptyLabel={t('empty')} exportName="manual-journals" />
    </div>
  );
}
