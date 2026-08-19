'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { Copy, Eye, Pencil, Plus, Trash2 } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { BranchViewToggle } from '@/components/ui/branch-view-toggle';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { branchViewQuery, type BranchView } from '@/lib/branch-view';
import { type EmployeeCustody } from '@/lib/employee-custody';
import { formatRiyal } from '@/lib/money';

const tone: Record<EmployeeCustody['status'], 'positive' | 'warning'> = {
  draft: 'warning',
  posted: 'positive',
};

export default function EmployeeCustodiesPage() {
  const t = useTranslations('employeeCustodies');
  const tc = useTranslations('common');
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [data, setData] = useState<EmployeeCustody[]>([]);
  const [loading, setLoading] = useState(true);
  const [view, setView] = useState<BranchView>('current');
  const [acting, setActing] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api<{ data: EmployeeCustody[] }>(`/employee-custodies${branchViewQuery(view, true)}`)
      .then((response) => setData(response.data))
      .catch((err) => toastError(err instanceof ApiError ? err.message : t('loadListFailed')))
      .finally(() => setLoading(false));
  }, [t, toastError, view]);

  useEffect(() => load(), [load]);

  const duplicate = useCallback(async (id: string) => {
    setActing(id);
    try {
      const response = await api<{ data: EmployeeCustody }>(`/employee-custodies/${id}/duplicate`, { method: 'POST' });
      success(t('duplicateSuccess'));
      router.push(`/employee-custodies/new?edit=${response.data.id}`);
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setActing(null);
    }
  }, [router, success, t, tc, toastError]);

  const remove = useCallback(async (id: string) => {
    if (!window.confirm(t('confirmDelete'))) return;
    setActing(id);
    try {
      await api(`/employee-custodies/${id}`, { method: 'DELETE' });
      success(t('deletedSuccess'));
      load();
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setActing(null);
    }
  }, [load, success, t, tc, toastError]);

  const post = useCallback(async (id: string) => {
    if (!window.confirm(t('confirmPost'))) return;
    setActing(id);
    try {
      await api(`/employee-custodies/${id}/post`, { method: 'POST' });
      success(t('postSuccess'));
      load();
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setActing(null);
    }
  }, [load, success, t, tc, toastError]);

  const columns = useMemo<ColumnDef<EmployeeCustody, unknown>[]>(() => [
    {
      accessorKey: 'number',
      header: t('number'),
      cell: ({ row }) => <Link href={`/employee-custodies/${row.original.id}`} className="num font-medium text-primary hover:underline">{row.original.number}</Link>,
    },
    {
      accessorKey: 'employee_name',
      header: t('employee'),
      cell: ({ row }) => (
        <div className="min-w-32">
          <p className="text-sm text-text">{row.original.employee_name || '—'}</p>
          {row.original.employee_no && <p className="num text-xs text-muted">{row.original.employee_no}</p>}
        </div>
      ),
    },
    { accessorKey: 'custody_date', header: t('date'), cell: ({ row }) => <span className="num text-muted">{row.original.custody_date}</span> },
    { accessorKey: 'due_date', header: t('dueDate'), cell: ({ row }) => <span className="num text-muted">{row.original.due_date || '—'}</span> },
    { accessorKey: 'amount', header: t('amount'), cell: ({ row }) => <span className="num font-medium">{formatRiyal(row.original.amount)}</span> },
    { accessorKey: 'remaining_amount', header: t('remaining'), cell: ({ row }) => <span className="num font-medium text-text">{row.original.status === 'posted' ? formatRiyal(row.original.remaining_amount ?? row.original.amount) : '—'}</span> },
    { accessorKey: 'status', header: t('status'), cell: ({ row }) => <div className="flex flex-wrap gap-1"><Badge tone={tone[row.original.status]}>{t(row.original.status)}</Badge>{row.original.is_settled && <Badge tone="positive">{t('settled')}</Badge>}</div> },
    {
      id: 'actions',
      header: t('actions'),
      cell: ({ row }) => {
        const custody = row.original;
        const draft = custody.status === 'draft';
        const busy = acting === custody.id;
        return (
          <div className="flex justify-end gap-1">
            <Link href={`/employee-custodies/${custody.id}`}>
              <Button size="icon" variant="ghost" aria-label={t('view')}><Eye className="h-4 w-4" strokeWidth={1.7} /></Button>
            </Link>
            {draft ? (
              <Link href={`/employee-custodies/new?edit=${custody.id}`}>
                <Button size="icon" variant="ghost" aria-label={t('edit')}><Pencil className="h-4 w-4" strokeWidth={1.7} /></Button>
              </Link>
            ) : (
              <Button size="icon" variant="ghost" disabled title={t('draftActionOnly')} aria-label={t('edit')}><Pencil className="h-4 w-4" strokeWidth={1.7} /></Button>
            )}
            <Button size="icon" variant="ghost" disabled={busy} onClick={() => duplicate(custody.id)} aria-label={t('duplicate')}><Copy className="h-4 w-4" strokeWidth={1.7} /></Button>
            <span title={draft ? t('settlementDraftOnly') : custody.is_settled ? t('settlementNoRemaining') : undefined}>
              <Button size="sm" variant="outline" disabled={draft || custody.is_settled || busy} onClick={() => router.push(`/employee-custodies/${custody.id}?settlement=1`)} aria-label={t('addSettlement')}><Plus className="h-4 w-4" strokeWidth={1.7} />{t('addSettlement')}</Button>
            </span>
            <Button size="icon" variant="ghost" disabled={!draft || busy} title={!draft ? t('draftActionOnly') : undefined} onClick={() => remove(custody.id)} aria-label={t('delete')}><Trash2 className="h-4 w-4 text-negative" strokeWidth={1.7} /></Button>
            {draft && <Button size="sm" variant="outline" disabled={busy} onClick={() => post(custody.id)}>{t('post')}</Button>}
          </div>
        );
      },
    },
  ], [acting, duplicate, post, remove, router, t]);

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted">{t('subtitle')}</p>
        </div>
        <div className="flex items-center gap-2">
          <BranchViewToggle value={view} onChange={setView} />
          <Link href="/employee-custodies/new"><Button><Plus className="h-4 w-4" strokeWidth={1.8} />{t('create')}</Button></Link>
        </div>
      </div>
      <DataTable columns={columns} data={data} loading={loading} searchPlaceholder={t('search')} emptyLabel={t('empty')} exportName="employee-custodies" />
    </div>
  );
}
