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

interface Asset {
  id: string;
  number: string;
  name: string;
  account_name?: string | null;
  total: string;
  accumulated_depreciation: string;
  book_value: string;
  status: string;
}

const statusTone: Record<string, 'positive' | 'muted' | 'negative'> = {
  active: 'positive',
  draft: 'muted',
  disposed: 'negative',
};

export default function AssetsPage() {
  const t = useTranslations('assets');
  const tc = useTranslations('common');
  const { success, error: toastError } = useToast();
  const [data, setData] = useState<Asset[]>([]);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api<{ data: Asset[] }>('/assets')
      .then((r) => setData(r.data))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => load(), [load]);

  const act = useCallback(
    async (id: string, action: 'post' | 'depreciate') => {
      setBusy(id);
      try {
        await api(`/assets/${id}/${action}`, { method: 'POST' });
        success(action === 'post' ? t('post_success') : t('depreciate_success'));
        load();
      } catch (err) {
        toastError(err instanceof ApiError ? err.message : tc('saveFailed'));
      } finally {
        setBusy(null);
      }
    },
    [load, success, toastError, t, tc],
  );

  const columns = useMemo<ColumnDef<Asset, unknown>[]>(
    () => [
      { accessorKey: 'number', header: t('number'), cell: ({ row }) => <span className="num">{row.original.number}</span> },
      { accessorKey: 'name', header: t('name') },
      { id: 'account', header: t('account'), accessorFn: (r) => r.account_name ?? '—', cell: ({ row }) => row.original.account_name ?? '—' },
      { accessorKey: 'total', header: t('cost'), cell: ({ row }) => <div className="num text-end">{formatRiyal(row.original.total)}</div> },
      { accessorKey: 'accumulated_depreciation', header: t('accumulated'), cell: ({ row }) => <div className="num text-end text-muted">{formatRiyal(row.original.accumulated_depreciation)}</div> },
      { accessorKey: 'book_value', header: t('book_value'), cell: ({ row }) => <div className="num text-end">{formatRiyal(row.original.book_value)}</div> },
      { accessorKey: 'status', header: t('status'), cell: ({ row }) => <Badge tone={statusTone[row.original.status] ?? 'muted'}>{t(row.original.status)}</Badge> },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => {
          const a = row.original;
          return (
            <div className="flex justify-end">
              {a.status === 'draft' && (
                <Button size="sm" variant="outline" disabled={busy === a.id} onClick={() => act(a.id, 'post')}>
                  {t('post')}
                </Button>
              )}
              {a.status === 'active' && (
                <Button size="sm" variant="outline" disabled={busy === a.id} onClick={() => act(a.id, 'depreciate')}>
                  {t('depreciate')}
                </Button>
              )}
            </div>
          );
        },
      },
    ],
    [t, busy, act],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
        <Link href="/assets/new">
          <Button>
            <Plus className="h-4 w-4" strokeWidth={1.8} />
            {t('create')}
          </Button>
        </Link>
      </div>

      <DataTable columns={columns} data={data} loading={loading} searchPlaceholder={t('search')} emptyLabel={t('empty')} exportName="assets" />
    </div>
  );
}
