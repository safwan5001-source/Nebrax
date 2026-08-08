'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus, Pencil, Boxes } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import type { Branch } from '@/lib/branch';
import type { Warehouse } from '@/lib/warehouse';

export default function WarehousesPage() {
  const t = useTranslations('warehouses');
  const [data, setData] = useState<Warehouse[]>([]);
  const [branches, setBranches] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api<{ data: Warehouse[] }>('/warehouses'),
      api<{ data: Branch[] }>('/branches'),
    ])
      .then(([w, b]) => {
        setData(w.data);
        setBranches(Object.fromEntries(b.data.map((x) => [x.id, x.name])));
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => load(), [load]);

  const columns = useMemo<ColumnDef<Warehouse, unknown>[]>(
    () => [
      {
        accessorKey: 'name',
        header: t('name'),
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <Link href={`/warehouses/${row.original.id}`} className="font-medium text-primary hover:underline">
              {row.original.name}
            </Link>
            {row.original.is_default && <Badge tone="positive">{t('default')}</Badge>}
          </div>
        ),
      },
      { accessorKey: 'code', header: t('code'), cell: ({ row }) => <span className="num text-muted">{row.original.code}</span> },
      {
        id: 'branch',
        header: t('branch'),
        accessorFn: (r) => (r.branch_id ? branches[r.branch_id] ?? '—' : ''),
        cell: ({ row }) => (row.original.branch_id ? branches[row.original.branch_id] ?? '—' : <span className="text-muted">{t('central')}</span>),
      },
      { accessorKey: 'city', header: t('city'), cell: ({ row }) => row.original.city || '—' },
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
          <div className="flex items-center justify-end gap-1">
            <Link href={`/warehouses/${row.original.id}/stock`}>
              <Button variant="ghost" size="icon" aria-label={t('stock')}>
                <Boxes className="h-4 w-4" strokeWidth={1.7} />
              </Button>
            </Link>
            <Link href={`/warehouses/${row.original.id}`}>
              <Button variant="ghost" size="icon" aria-label={t('edit_title')}>
                <Pencil className="h-4 w-4" strokeWidth={1.7} />
              </Button>
            </Link>
          </div>
        ),
      },
    ],
    [t, branches],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
          <p className="mt-1 text-sm text-muted">{t('subtitle')}</p>
        </div>
        <Link href="/warehouses/new">
          <Button>
            <Plus className="h-4 w-4" strokeWidth={1.8} />
            {t('add')}
          </Button>
        </Link>
      </div>

      <DataTable
        columns={columns}
        data={data}
        loading={loading}
        searchPlaceholder={t('search')}
        emptyLabel={t('empty')}
        exportName="warehouses"
      />
    </div>
  );
}
