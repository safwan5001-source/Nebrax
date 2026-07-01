'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus, Pencil, Trash2 } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { useToast } from '@/components/ui/toast';
import { CostCenterDialog, type CostCenter } from '@/components/cost-centers/cost-center-dialog';
import { api, ApiError } from '@/lib/api';

export default function CostCentersPage() {
  const t = useTranslations('costCenters');
  const tc = useTranslations('common');
  const { success, error: toastError } = useToast();
  const [data, setData] = useState<CostCenter[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialog, setDialog] = useState(false);
  const [editing, setEditing] = useState<CostCenter | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api<{ data: CostCenter[] }>('/cost-centers')
      .then((r) => setData(r.data))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => load(), [load]);

  const remove = useCallback(
    async (id: string) => {
      if (!confirm(t('confirm_delete'))) return;
      try {
        await api(`/cost-centers/${id}`, { method: 'DELETE' });
        success(tc('deleted'));
        load();
      } catch (err) {
        toastError(err instanceof ApiError ? err.message : tc('saveFailed'));
      }
    },
    [load, success, toastError, t, tc],
  );

  const columns = useMemo<ColumnDef<CostCenter, unknown>[]>(
    () => [
      { accessorKey: 'code', header: t('code'), cell: ({ row }) => <span className="num">{row.original.code}</span> },
      { accessorKey: 'name', header: t('name') },
      {
        accessorKey: 'is_active',
        header: t('status'),
        cell: ({ row }) => (
          <Badge tone={row.original.is_active ? 'positive' : 'muted'}>
            {row.original.is_active ? t('active') : t('inactive')}
          </Badge>
        ),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <div className="flex justify-end gap-1">
            <Button variant="ghost" size="icon" aria-label={t('edit')} onClick={() => { setEditing(row.original); setDialog(true); }}>
              <Pencil className="h-4 w-4" strokeWidth={1.7} />
            </Button>
            <Button variant="ghost" size="icon" aria-label={t('delete')} onClick={() => remove(row.original.id)}>
              <Trash2 className="h-4 w-4 text-negative" strokeWidth={1.7} />
            </Button>
          </div>
        ),
      },
    ],
    [t, remove],
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
        <Button onClick={() => { setEditing(null); setDialog(true); }}>
          <Plus className="h-4 w-4" strokeWidth={1.8} />
          {t('add')}
        </Button>
      </div>

      <DataTable columns={columns} data={data} loading={loading} searchPlaceholder={t('search')} emptyLabel={t('empty')} exportName="cost-centers" />

      {dialog && (
        <CostCenterDialog
          key={editing?.id ?? 'new'}
          open={dialog}
          onClose={() => setDialog(false)}
          onSaved={load}
          center={editing}
        />
      )}
    </div>
  );
}
