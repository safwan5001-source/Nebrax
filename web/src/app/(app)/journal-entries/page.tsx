'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { Eye, FilePlus, Link as LinkIcon } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { BranchViewToggle } from '@/components/ui/branch-view-toggle';
import { api, ApiError } from '@/lib/api';
import { branchViewQuery, type BranchView } from '@/lib/branch-view';
import { formatRiyal } from '@/lib/money';
import { useToast } from '@/components/ui/toast';

interface JournalEntry {
  id: string;
  number: string;
  entry_date: string;
  description?: string | null;
  status: string;
  entry_kind: 'manual' | 'automatic' | 'reversal';
  source_type?: string | null;
  source_id?: string | null;
  total: string;
}

const sourcePath = (sourceType?: string | null, sourceId?: string | null): string | null => {
  if (!sourceType || !sourceId) return null;
  const name = sourceType.split('\\').pop();
  const paths: Record<string, string> = {
    Invoice: '/invoices', Purchase: '/purchases', Payment: '/payments', Expense: '/expenses',
    CreditNote: '/credit-notes', ReturnDocument: '/returns', Asset: '/assets', ManualJournal: '/manual-journals',
  };
  return paths[name ?? ''] ? `${paths[name ?? '']}/${sourceId}` : null;
};

export default function JournalEntriesPage() {
  const t = useTranslations('journalEntries');
  const tc = useTranslations('common');
  const { error: toastError } = useToast();
  const [entries, setEntries] = useState<JournalEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<BranchView>('current');

  const load = useCallback(() => {
    setLoading(true);
    api<{ data: JournalEntry[] }>(`/journal-entries${branchViewQuery(view)}`)
      .then((response) => setEntries(response.data))
      .catch((err) => toastError(err instanceof ApiError ? err.message : tc('loadFailed')))
      .finally(() => setLoading(false));
  }, [tc, toastError, view]);

  useEffect(() => load(), [load]);

  const columns = useMemo<ColumnDef<JournalEntry, unknown>[]>(() => [
    { accessorKey: 'number', header: t('number'), cell: ({ row }) => <Link href={`/journal-entries/${row.original.id}`} className="num font-medium text-primary hover:underline">{row.original.number}</Link> },
    { accessorKey: 'entry_date', header: t('date'), cell: ({ row }) => <span className="num text-muted">{row.original.entry_date}</span> },
    { accessorKey: 'description', header: t('source'), cell: ({ row }) => <span className="line-clamp-2 font-medium text-text">{row.original.description || t('noDescription')}</span> },
    { accessorKey: 'entry_kind', header: t('type'), cell: ({ row }) => <Badge tone={row.original.entry_kind === 'automatic' ? 'positive' : row.original.entry_kind === 'reversal' ? 'negative' : 'muted'}>{t(row.original.entry_kind)}</Badge> },
    { accessorKey: 'total', header: t('amount'), cell: ({ row }) => <span className="num block text-end font-medium text-text">{formatRiyal(row.original.total)}</span> },
    { id: 'actions', header: t('actions'), cell: ({ row }) => {
      const entry = row.original;
      const source = sourcePath(entry.source_type, entry.source_id);
      return <div className="flex justify-end gap-1"><Link href={`/journal-entries/${entry.id}`}><Button size="icon" variant="ghost" aria-label={t('view')}><Eye className="h-4 w-4" strokeWidth={1.7} /></Button></Link>{source && <Link href={source}><Button size="icon" variant="ghost" aria-label={t('viewSource')}><LinkIcon className="h-4 w-4" strokeWidth={1.7} /></Button></Link>}</div>;
    } },
  ], [t]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div><h1 className="text-xl font-semibold text-text">{t('title')}</h1><p className="mt-1 text-sm text-muted">{t('subtitle')}</p></div>
        <div className="flex flex-wrap items-center gap-2"><BranchViewToggle value={view} onChange={setView} /><Link href="/manual-journals"><Button variant="outline">{t('drafts')}</Button></Link><Link href="/manual-journals/new"><Button><FilePlus className="h-4 w-4" strokeWidth={1.8} />{t('newManual')}</Button></Link></div>
      </div>
      <DataTable columns={columns} data={entries} loading={loading} searchPlaceholder={t('search')} emptyLabel={t('empty')} exportName="journal-entries" />
    </div>
  );
}
