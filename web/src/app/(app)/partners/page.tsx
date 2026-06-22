'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus, Pencil } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { Button } from '@/components/ui/button';
import { Badge } from '@/components/ui/badge';
import { PartnerDialog, type Partner } from '@/components/partners/partner-dialog';
import { api } from '@/lib/api';

export default function PartnersPage() {
  const tp = useTranslations('partners');
  const [data, setData] = useState<Partner[]>([]);
  const [loading, setLoading] = useState(true);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<Partner | null>(null);

  const load = useCallback(() => {
    setLoading(true);
    api<{ data: Partner[] }>('/partners')
      .then((r) => setData(r.data))
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => load(), [load]);

  const typeTone: Record<string, 'neutral' | 'positive' | 'muted'> = {
    customer: 'neutral',
    supplier: 'positive',
    both: 'muted',
  };

  const columns = useMemo<ColumnDef<Partner, unknown>[]>(
    () => [
      {
        accessorKey: 'name',
        header: tp('name'),
        cell: ({ row }) => (
          <Link href={`/partners/${row.original.id}`} className="text-primary hover:underline">
            {row.original.name}
          </Link>
        ),
      },
      {
        accessorKey: 'type',
        header: tp('type'),
        cell: ({ row }) => <Badge tone={typeTone[row.original.type] ?? 'muted'}>{tp(row.original.type)}</Badge>,
      },
      { accessorKey: 'city', header: tp('city'), cell: ({ row }) => row.original.city ?? '—' },
      {
        accessorKey: 'phone',
        header: tp('phone'),
        cell: ({ row }) => <span className="num text-muted">{row.original.phone ?? '—'}</span>,
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <Button
            variant="ghost"
            size="icon"
            aria-label={tp('edit')}
            onClick={() => {
              setEditing(row.original);
              setDialogOpen(true);
            }}
          >
            <Pencil className="h-4 w-4" strokeWidth={1.7} />
          </Button>
        ),
      },
    ],
    [tp]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-text">{tp('title')}</h1>
        <Button
          onClick={() => {
            setEditing(null);
            setDialogOpen(true);
          }}
        >
          <Plus className="h-4 w-4" strokeWidth={1.8} />
          {tp('add')}
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={data}
        loading={loading}
        searchPlaceholder={tp('search')}
        emptyLabel={tp('empty')}
        exportName="partners"
      />

      <PartnerDialog open={dialogOpen} onClose={() => setDialogOpen(false)} onSaved={load} partner={editing} />
    </div>
  );
}
