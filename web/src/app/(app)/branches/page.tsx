'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus, Pencil, SlidersHorizontal } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import type { Branch } from '@/lib/branch';

export default function BranchesPage() {
  const t = useTranslations('branches');
  const [data, setData] = useState<Branch[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    api<{ data: Branch[] }>('/branches')
      .then((r) => setData(r.data))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => load(), [load]);

  const columns = useMemo<ColumnDef<Branch, unknown>[]>(
    () => [
      {
        accessorKey: 'name',
        header: t('name'),
        cell: ({ row }) => (
          <div className="flex items-center gap-2">
            <Link href={`/branches/${row.original.id}`} className="font-medium text-primary hover:underline">
              {row.original.name}
            </Link>
            {row.original.is_main && <Badge tone="positive">{t('main')}</Badge>}
          </div>
        ),
      },
      { accessorKey: 'code', header: t('code'), cell: ({ row }) => <span className="num text-muted">{row.original.code}</span> },
      { accessorKey: 'phone', header: t('phone'), cell: ({ row }) => <span className="num text-muted">{row.original.phone || '—'}</span> },
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
          <Link href={`/branches/${row.original.id}`}>
            <Button variant="ghost" size="icon" aria-label={t('edit_title')}>
              <Pencil className="h-4 w-4" strokeWidth={1.7} />
            </Button>
          </Link>
        ),
      },
    ],
    [t],
  );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
        <div className="flex items-center gap-2">
          <Link href="/branches/settings">
            <Button variant="outline">
              <SlidersHorizontal className="h-4 w-4" strokeWidth={1.8} />
              {t('settings_title')}
            </Button>
          </Link>
          <Link href="/branches/new">
            <Button>
              <Plus className="h-4 w-4" strokeWidth={1.8} />
              {t('add')}
            </Button>
          </Link>
        </div>
      </div>

      <DataTable
        columns={columns}
        data={data}
        loading={loading}
        searchPlaceholder={t('search')}
        emptyLabel={t('empty')}
        exportName="branches"
      />
    </div>
  );
}
