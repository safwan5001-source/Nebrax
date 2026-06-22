'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { PaymentDialog } from '@/components/payments/payment-dialog';
import { api } from '@/lib/api';
import { formatRiyal } from '@/lib/money';

interface Payment {
  id: string;
  number: string;
  partner_id: string;
  direction: string;
  method: string;
  payment_date: string;
  amount: string;
}
interface Partner { id: string; name: string }

export default function PaymentsPage() {
  const t = useTranslations('payments');
  const [data, setData] = useState<Payment[]>([]);
  const [partners, setPartners] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([api<{ data: Payment[] }>('/payments'), api<{ data: Partner[] }>('/partners')])
      .then(([pay, prt]) => {
        setData(pay.data);
        setPartners(Object.fromEntries(prt.data.map((p) => [p.id, p.name])));
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => load(), [load]);

  const columns = useMemo<ColumnDef<Payment, unknown>[]>(
    () => [
      { accessorKey: 'number', header: t('number'), cell: ({ row }) => <span className="num">{row.original.number}</span> },
      {
        id: 'partner',
        header: t('partner'),
        accessorFn: (r) => partners[r.partner_id] ?? '—',
        cell: ({ row }) => partners[row.original.partner_id] ?? '—',
      },
      {
        accessorKey: 'direction',
        header: t('direction'),
        cell: ({ row }) => (
          <Badge tone={row.original.direction === 'received' ? 'positive' : 'warning'}>
            {t(row.original.direction)}
          </Badge>
        ),
      },
      { accessorKey: 'method', header: t('method'), cell: ({ row }) => t(row.original.method) },
      {
        accessorKey: 'payment_date',
        header: t('date'),
        cell: ({ row }) => <span className="num text-muted">{row.original.payment_date}</span>,
      },
      {
        accessorKey: 'amount',
        header: t('amount'),
        cell: ({ row }) => <div className="num text-end">{formatRiyal(row.original.amount)}</div>,
      },
    ],
    [partners, t]
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

      <DataTable columns={columns} data={data} loading={loading} searchPlaceholder={t('search')} emptyLabel={t('empty')} exportName="payments" />

      <PaymentDialog open={open} onClose={() => setOpen(false)} onSaved={load} />
    </div>
  );
}
