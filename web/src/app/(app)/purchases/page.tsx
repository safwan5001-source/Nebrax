'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CreatePurchaseDialog } from '@/components/purchases/create-purchase-dialog';
import { api } from '@/lib/api';
import { formatRiyal } from '@/lib/money';

interface Purchase {
  id: string;
  number: string;
  partner_id: string;
  purchase_date: string;
  total: string;
  status: string;
  payment_status: string;
}
interface Partner { id: string; name: string }

const statusTone: Record<string, 'positive' | 'muted' | 'negative'> = { posted: 'positive', draft: 'muted', cancelled: 'negative' };
const payTone: Record<string, 'positive' | 'warning' | 'muted'> = { paid: 'positive', partial: 'warning', unpaid: 'muted' };

export default function PurchasesPage() {
  const t = useTranslations('purchases');
  const ts = useTranslations('status');
  const [data, setData] = useState<Purchase[]>([]);
  const [partners, setPartners] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([api<{ data: Purchase[] }>('/purchases'), api<{ data: Partner[] }>('/partners')])
      .then(([pur, prt]) => {
        setData(pur.data);
        setPartners(Object.fromEntries(prt.data.map((p) => [p.id, p.name])));
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => load(), [load]);

  const columns = useMemo<ColumnDef<Purchase, unknown>[]>(
    () => [
      {
        accessorKey: 'number',
        header: t('number'),
        cell: ({ row }) => (
          <Link href={`/purchases/${row.original.id}`} className="num text-primary hover:underline">
            {row.original.number}
          </Link>
        ),
      },
      {
        id: 'partner',
        header: t('supplier'),
        accessorFn: (r) => partners[r.partner_id] ?? '—',
        cell: ({ row }) => partners[row.original.partner_id] ?? '—',
      },
      { accessorKey: 'purchase_date', header: t('date'), cell: ({ row }) => <span className="num text-muted">{row.original.purchase_date}</span> },
      { accessorKey: 'total', header: t('total'), cell: ({ row }) => <div className="num text-end">{formatRiyal(row.original.total)}</div> },
      { accessorKey: 'status', header: t('status'), cell: ({ row }) => <Badge tone={statusTone[row.original.status] ?? 'muted'}>{ts(row.original.status)}</Badge> },
      { accessorKey: 'payment_status', header: t('payment_status'), cell: ({ row }) => <Badge tone={payTone[row.original.payment_status] ?? 'muted'}>{ts(row.original.payment_status)}</Badge> },
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
      <DataTable columns={columns} data={data} loading={loading} searchPlaceholder={t('search')} emptyLabel={t('empty')} exportName="purchases" />
      <CreatePurchaseDialog open={open} onClose={() => setOpen(false)} onCreated={load} />
    </div>
  );
}
