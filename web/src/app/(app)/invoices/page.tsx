'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { CreateInvoiceDialog } from '@/components/invoices/create-invoice-dialog';
import { api } from '@/lib/api';
import { formatRiyal } from '@/lib/money';

interface Invoice {
  id: string;
  number: string;
  partner_id: string;
  invoice_date: string;
  total: string;
  status: string;
  payment_status: string;
}
interface Partner { id: string; name: string }

const statusTone: Record<string, 'positive' | 'muted' | 'negative'> = {
  posted: 'positive',
  draft: 'muted',
  cancelled: 'negative',
};
const payTone: Record<string, 'positive' | 'warning' | 'muted'> = {
  paid: 'positive',
  partial: 'warning',
  unpaid: 'muted',
};

export default function InvoicesPage() {
  const t = useTranslations('invoices');
  const ts = useTranslations('status');
  const [loading, setLoading] = useState(true);
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [partners, setPartners] = useState<Record<string, string>>({});
  const [createOpen, setCreateOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([api<{ data: Invoice[] }>('/invoices'), api<{ data: Partner[] }>('/partners')])
      .then(([inv, prt]) => {
        setInvoices(inv.data);
        setPartners(Object.fromEntries(prt.data.map((p) => [p.id, p.name])));
      })
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => load(), [load]);

  const columns = useMemo<ColumnDef<Invoice, unknown>[]>(
    () => [
      {
        accessorKey: 'number',
        header: t('number'),
        cell: ({ row }) => <span className="num">{row.original.number}</span>,
      },
      {
        id: 'partner',
        header: t('partner'),
        accessorFn: (row) => partners[row.partner_id] ?? '—',
        cell: ({ row }) => partners[row.original.partner_id] ?? '—',
      },
      {
        accessorKey: 'invoice_date',
        header: t('date'),
        cell: ({ row }) => <span className="num text-muted">{row.original.invoice_date}</span>,
      },
      {
        accessorKey: 'total',
        header: t('total'),
        cell: ({ row }) => <div className="num text-end">{formatRiyal(row.original.total)}</div>,
      },
      {
        accessorKey: 'status',
        header: t('status'),
        cell: ({ row }) => <Badge tone={statusTone[row.original.status] ?? 'muted'}>{ts(row.original.status)}</Badge>,
      },
      {
        accessorKey: 'payment_status',
        header: t('payment_status'),
        cell: ({ row }) => (
          <Badge tone={payTone[row.original.payment_status] ?? 'muted'}>{ts(row.original.payment_status)}</Badge>
        ),
      },
    ],
    [partners, t, ts]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-text">{t('title')}</h1>
        <Button onClick={() => setCreateOpen(true)}>
          <Plus className="h-4 w-4" strokeWidth={1.8} />
          {t('create')}
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={invoices}
        loading={loading}
        searchPlaceholder={t('search')}
        emptyLabel="لا توجد فواتير"
      />

      <CreateInvoiceDialog open={createOpen} onClose={() => setCreateOpen(false)} onCreated={load} />
    </div>
  );
}
