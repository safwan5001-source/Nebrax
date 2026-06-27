'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { api } from '@/lib/api';
import { formatRiyal } from '@/lib/money';

interface Recurring {
  id: string;
  title: string | null;
  partner_id: string;
  frequency: string;
  next_run_date: string;
  generated_count: number;
  total: string;
  active: boolean;
}
interface Partner { id: string; name: string }

export default function RecurringInvoicesPage() {
  const t = useTranslations('recurring');
  const [data, setData] = useState<Recurring[]>([]);
  const [partners, setPartners] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([api<{ data: Recurring[] }>('/recurring-invoices'), api<{ data: Partner[] }>('/partners')])
      .then(([rec, prt]) => {
        setData(rec.data);
        setPartners(Object.fromEntries(prt.data.map((p) => [p.id, p.name])));
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => load(), [load]);

  const columns = useMemo<ColumnDef<Recurring, unknown>[]>(
    () => [
      {
        accessorKey: 'title',
        header: t('template'),
        cell: ({ row }) => (
          <Link href={`/recurring-invoices/${row.original.id}`} className="text-primary hover:underline">
            {row.original.title || (partners[row.original.partner_id] ?? '—')}
          </Link>
        ),
      },
      {
        id: 'partner',
        header: t('partner'),
        accessorFn: (r) => partners[r.partner_id] ?? '—',
        cell: ({ row }) => partners[row.original.partner_id] ?? '—',
      },
      { accessorKey: 'frequency', header: t('frequency'), cell: ({ row }) => <Badge tone="neutral">{t(row.original.frequency)}</Badge> },
      { accessorKey: 'next_run_date', header: t('next_run'), cell: ({ row }) => <span className="num text-muted">{row.original.next_run_date}</span> },
      { accessorKey: 'total', header: t('total'), cell: ({ row }) => <div className="num text-end">{formatRiyal(row.original.total)}</div> },
      { accessorKey: 'active', header: t('status'), cell: ({ row }) => <Badge tone={row.original.active ? 'positive' : 'muted'}>{row.original.active ? t('active') : t('inactive')}</Badge> },
    ],
    [partners, t]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
        <Link href="/recurring-invoices/new">
          <Button>
            <Plus className="h-4 w-4" strokeWidth={1.8} />
            {t('create')}
          </Button>
        </Link>
      </div>

      <DataTable columns={columns} data={data} loading={loading} searchPlaceholder={t('search')} emptyLabel={t('empty')} exportName="recurring-invoices" />
    </div>
  );
}
