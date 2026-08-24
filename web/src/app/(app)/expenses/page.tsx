'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { type ColumnDef } from '@tanstack/react-table';
import { Copy, Eye, Pencil, Plus, Settings2, Trash2 } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { BranchViewToggle } from '@/components/ui/branch-view-toggle';
import { branchViewQuery, type BranchView } from '@/lib/branch-view';
import { formatRiyal } from '@/lib/money';

interface Expense {
  id: string;
  number: string;
  account_name?: string | null;
  category_name?: string | null;
  vendor_name?: string | null;
  expense_date: string;
  payment_method: string;
  total: string;
  status: string;
}

const statusTone: Record<string, 'positive' | 'muted' | 'negative'> = {
  posted: 'positive',
  draft: 'muted',
  cancelled: 'negative',
};

export default function ExpensesPage() {
  const t = useTranslations('expenses');
  const tc = useTranslations('common');
  const router = useRouter();
  const { success, error: toastError } = useToast();
  const [data, setData] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState<string | null>(null);
  const [acting, setActing] = useState<string | null>(null);

  // نطاق العرض: الفرع النشط افتراضياً؛ لا يُحفظ فيبدأ كل فتح من الافتراضي.
  const [view, setView] = useState<BranchView>('current');

  const load = useCallback(() => {
    setLoading(true);
    api<{ data: Expense[] }>(`/expenses${branchViewQuery(view)}`)
      .then((r) => setData(r.data))
      .finally(() => setLoading(false));
  }, [view]);

  useEffect(() => load(), [load]);

  const postExpense = useCallback(
    async (id: string) => {
      setPosting(id);
      try {
        await api(`/expenses/${id}/post`, { method: 'POST' });
        success(t('post_success'));
        load();
      } catch (err) {
        toastError(err instanceof ApiError ? err.message : tc('saveFailed'));
      } finally {
        setPosting(null);
      }
    },
    [load, success, toastError, t, tc],
  );

  const duplicateExpense = useCallback(async (id: string) => {
    setActing(id);
    try {
      const response = await api<{ data: Expense }>(`/expenses/${id}/duplicate`, { method: 'POST' });
      success(t('duplicate_success'));
      router.push(`/expenses/new?edit=${response.data.id}`);
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setActing(null);
    }
  }, [router, success, t, tc, toastError]);

  const deleteExpense = useCallback(async (id: string) => {
    if (!window.confirm(t('confirm_delete_expense'))) return;
    setActing(id);
    try {
      await api(`/expenses/${id}`, { method: 'DELETE' });
      success(t('deleted_success'));
      load();
    } catch (err) {
      toastError(err instanceof ApiError ? err.message : tc('saveFailed'));
    } finally {
      setActing(null);
    }
  }, [load, success, t, tc, toastError]);

  const columns = useMemo<ColumnDef<Expense, unknown>[]>(
    () => [
      { accessorKey: 'number', header: t('number'), cell: ({ row }) => <Link href={`/expenses/${row.original.id}`} className="num font-medium text-primary hover:underline">{row.original.number}</Link> },
      { id: 'account', header: t('account'), accessorFn: (r) => r.account_name ?? '—', cell: ({ row }) => row.original.account_name ?? '—' },
      { id: 'category', header: t('category'), accessorFn: (r) => r.category_name ?? '—', cell: ({ row }) => row.original.category_name ?? '—' },
      { id: 'vendor', header: t('vendor_name'), accessorFn: (r) => r.vendor_name ?? '—', cell: ({ row }) => row.original.vendor_name ?? '—' },
      { accessorKey: 'expense_date', header: t('date'), cell: ({ row }) => <span className="num text-muted">{row.original.expense_date}</span> },
      { id: 'method', header: t('payment_method'), accessorFn: (r) => r.payment_method, cell: ({ row }) => t(`method.${row.original.payment_method}`) },
      { accessorKey: 'total', header: t('total'), cell: ({ row }) => <div className="num text-end">{formatRiyal(row.original.total)}</div> },
      { accessorKey: 'status', header: t('status'), cell: ({ row }) => <Badge tone={statusTone[row.original.status] ?? 'muted'}>{t(row.original.status)}</Badge> },
      {
        id: 'actions',
        header: t('actions'),
        cell: ({ row }) => {
          const expense = row.original;
          const isDraft = expense.status === 'draft';
          const busy = acting === expense.id || posting === expense.id;
          return (
            <div className="flex justify-end gap-1">
              <Button asChild size="icon" variant="ghost" aria-label={t('view')}><Link href={`/expenses/${expense.id}`}><Eye className="h-4 w-4" strokeWidth={1.7} /></Link></Button>
              {isDraft ? (
                <Button asChild size="icon" variant="ghost" aria-label={t('edit')}><Link href={`/expenses/new?edit=${expense.id}`}><Pencil className="h-4 w-4" strokeWidth={1.7} /></Link></Button>
              ) : <Button size="icon" variant="ghost" disabled title={t('draft_action_only')} aria-label={t('edit')}><Pencil className="h-4 w-4" strokeWidth={1.7} /></Button>}
              <Button size="icon" variant="ghost" disabled={busy} onClick={() => duplicateExpense(expense.id)} aria-label={t('duplicate')}><Copy className="h-4 w-4" strokeWidth={1.7} /></Button>
              <Button size="icon" variant="ghost" disabled={!isDraft || busy} title={!isDraft ? t('draft_action_only') : undefined} onClick={() => deleteExpense(expense.id)} aria-label={t('delete')}><Trash2 className="h-4 w-4 text-negative" strokeWidth={1.7} /></Button>
              {isDraft && <Button size="sm" variant="outline" disabled={busy} onClick={() => postExpense(expense.id)}>{t('post')}</Button>}
            </div>
          );
        },
      },
    ],
    [t, posting, acting, postExpense, duplicateExpense, deleteExpense],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
        {/* نطاق العرض ظاهر في الشاشة نفسها — لا مخفيّاً في الإعدادات. */}
        <BranchViewToggle value={view} onChange={setView} />
        <div className="flex items-center gap-2">
          <Button asChild variant="outline"><Link href="/expenses/categories">
              <Settings2 className="h-4 w-4" strokeWidth={1.8} />
              {t('manage_categories')}
            </Link></Button>
          <Link href="/expenses/new">
            <Button>
              <Plus className="h-4 w-4" strokeWidth={1.8} />
              {t('create')}
            </Button>
          </Link>
        </div>
      </div>

      <DataTable columns={columns} data={data} loading={loading} searchPlaceholder={t('search')} emptyLabel={t('empty')} exportName="expenses" />
    </div>
  );
}
