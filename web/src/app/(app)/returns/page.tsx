'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CreateReturnDialog } from '@/components/returns/create-return-dialog';
import { api } from '@/lib/api';
import { formatRiyal } from '@/lib/money';

interface ReturnDoc {
  id: string;
  number: string;
  type: string;
  partner_id: string;
  return_date: string;
  total: string;
  status: string;
}
interface Partner { id: string; name: string }

export default function ReturnsPage() {
  const t = useTranslations('returns');
  const ts = useTranslations('status');
  const [data, setData] = useState<ReturnDoc[]>([]);
  const [partners, setPartners] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([api<{ data: ReturnDoc[] }>('/returns'), api<{ data: Partner[] }>('/partners')])
      .then(([ret, prt]) => {
        setData(ret.data);
        setPartners(Object.fromEntries(prt.data.map((p) => [p.id, p.name])));
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => load(), [load]);

  const columns = useMemo<ColumnDef<ReturnDoc, unknown>[]>(
    () => [
      { accessorKey: 'number', header: t('number'), cell: ({ row }) => <span className="num">{row.original.number}</span> },
      {
        accessorKey: 'type',
        header: t('type'),
        cell: ({ row }) => (
          <Badge tone={row.original.type === 'sales' ? 'neutral' : 'warning'}>{t(row.original.type)}</Badge>
        ),
      },
      {
        id: 'partner',
        header: t('partner'),
        accessorFn: (r) => partners[r.partner_id] ?? '—',
        cell: ({ row }) => partners[row.original.partner_id] ?? '—',
      },
      { accessorKey: 'return_date', header: t('date'), cell: ({ row }) => <span className="num text-muted">{row.original.return_date}</span> },
      { accessorKey: 'total', header: t('total'), cell: ({ row }) => <div className="num text-end">{formatRiyal(row.original.total)}</div> },
      { accessorKey: 'status', header: t('status'), cell: ({ row }) => <Badge tone={row.original.status === 'posted' ? 'positive' : 'muted'}>{ts(row.original.status)}</Badge> },
    ],
    [partners, t, ts]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
        <Button onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" strokeWidth={1.8} />
          {t('create')}
        </Button>
      </div>
      <DataTable columns={columns} data={data} loading={loading} searchPlaceholder={t('search')} emptyLabel={t('empty')} />
      <CreateReturnDialog open={open} onClose={() => setOpen(false)} onCreated={load} />
    </div>
  );
}
