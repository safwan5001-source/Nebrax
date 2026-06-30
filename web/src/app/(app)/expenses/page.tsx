'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { api, ApiError } from '@/lib/api';
import { formatRiyal } from '@/lib/money';

interface Expense {
  id: string;
  number: string;
  account_name?: string | null;
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
  const { success, error: toastError } = useToast();
  const [data, setData] = useState<Expense[]>([]);
  const [loading, setLoading] = useState(true);
  const [posting, setPosting] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api<{ data: Expense[] }>('/expenses')
      .then((r) => setData(r.data))
      .finally(() => setLoading(false));
  }, []);

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

  const columns = useMemo<ColumnDef<Expense, unknown>[]>(
    () => [
      { accessorKey: 'number', header: t('number'), cell: ({ row }) => <span className="num">{row.original.number}</span> },
      { id: 'account', header: t('account'), accessorFn: (r) => r.account_name ?? '—', cell: ({ row }) => row.original.account_name ?? '—' },
      { accessorKey: 'expense_date', header: t('date'), cell: ({ row }) => <span className="num text-muted">{row.original.expense_date}</span> },
      { id: 'method', header: t('payment_method'), accessorFn: (r) => r.payment_method, cell: ({ row }) => t(`method.${row.original.payment_method}`) },
      { accessorKey: 'total', header: t('total'), cell: ({ row }) => <div className="num text-end">{formatRiyal(row.original.total)}</div> },
      { accessorKey: 'status', header: t('status'), cell: ({ row }) => <Badge tone={statusTone[row.original.status] ?? 'muted'}>{t(row.original.status)}</Badge> },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) =>
          row.original.status === 'draft' ? (
            <div className="text-end">
              <Button size="sm" variant="outline" disabled={posting === row.original.id} onClick={() => postExpense(row.original.id)}>
                {t('post')}
              </Button>
            </div>
          ) : null,
      },
    ],
    [t, posting, postExpense],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
        <Link href="/expenses/new">
          <Button>
            <Plus className="h-4 w-4" strokeWidth={1.8} />
            {t('create')}
          </Button>
        </Link>
      </div>

      <DataTable columns={columns} data={data} loading={loading} searchPlaceholder={t('search')} emptyLabel={t('empty')} exportName="expenses" />
    </div>
  );
}
