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

interface Quote {
  id: string;
  number: string;
  partner_id: string;
  status: string;
  quote_date: string;
  valid_until: string | null;
  total: string;
}
interface Partner { id: string; name: string }

const statusTone: Record<string, 'positive' | 'warning' | 'muted' | 'negative' | 'neutral'> = {
  draft: 'muted',
  sent: 'neutral',
  accepted: 'positive',
  rejected: 'negative',
  converted: 'positive',
};

export default function QuotesPage() {
  const t = useTranslations('quotes');
  const [data, setData] = useState<Quote[]>([]);
  const [partners, setPartners] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([api<{ data: Quote[] }>('/quotes'), api<{ data: Partner[] }>('/partners')])
      .then(([q, prt]) => {
        setData(q.data);
        setPartners(Object.fromEntries(prt.data.map((p) => [p.id, p.name])));
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => load(), [load]);

  const columns = useMemo<ColumnDef<Quote, unknown>[]>(
    () => [
      {
        accessorKey: 'number',
        header: t('number'),
        cell: ({ row }) => (
          <Link href={`/quotes/${row.original.id}`} className="num text-primary hover:underline">
            {row.original.number}
          </Link>
        ),
      },
      {
        id: 'partner',
        header: t('partner'),
        accessorFn: (r) => partners[r.partner_id] ?? '—',
        cell: ({ row }) => partners[row.original.partner_id] ?? '—',
      },
      { accessorKey: 'quote_date', header: t('date'), cell: ({ row }) => <span className="num text-muted">{row.original.quote_date}</span> },
      { accessorKey: 'valid_until', header: t('valid_until'), cell: ({ row }) => <span className="num text-muted">{row.original.valid_until ?? '—'}</span> },
      { accessorKey: 'total', header: t('total'), cell: ({ row }) => <div className="num text-end">{formatRiyal(row.original.total)}</div> },
      { accessorKey: 'status', header: t('status'), cell: ({ row }) => <Badge tone={statusTone[row.original.status] ?? 'muted'}>{t(row.original.status)}</Badge> },
    ],
    [partners, t]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
        <Link href="/quotes/new">
          <Button>
            <Plus className="h-4 w-4" strokeWidth={1.8} />
            {t('create')}
          </Button>
        </Link>
      </div>

      <DataTable columns={columns} data={data} loading={loading} searchPlaceholder={t('search')} emptyLabel={t('empty')} exportName="quotes" />
    </div>
  );
}
