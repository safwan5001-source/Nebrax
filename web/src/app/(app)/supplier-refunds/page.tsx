'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { PageHeader, type PageAction } from '@/components/nebrax';
import { Badge } from '@/components/ui/badge';
import { Label } from '@/components/ui/label';
import { Select } from '@/components/ui/select';
import { CreateSupplierRefundDialog } from '@/components/supplier-refunds/create-supplier-refund-dialog';
import { api } from '@/lib/api';
import { formatRiyal } from '@/lib/money';

interface SupplierRefund {
  id: string;
  number: string;
  partner_name?: string | null;
  refund_date: string;
  amount: string;
  method: string;
  payment_method_name: string | null;
  status: 'draft' | 'posted' | 'reversed';
}

const tone: Record<SupplierRefund['status'], 'warning' | 'positive' | 'muted'> = {
  draft: 'warning',
  posted: 'positive',
  reversed: 'muted',
};

/**
 * استرداد المورّد — عودة المال فعلاً مقابل مرتجعات مشتريات مرحّلة.
 * مستقلٌّ عن المرتجع نفسه: المرتجع يعكس الذمّة تجارياً ولا يحرّك نقداً.
 */
export default function SupplierRefundsPage() {
  const t = useTranslations('supplierRefunds');
  const [data, setData] = useState<SupplierRefund[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<'' | SupplierRefund['status']>('');
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    const query = status ? `?status=${status}` : '';
    api<{ data: SupplierRefund[] }>(`/supplier-refunds${query}`)
      .then((response) => setData(response.data))
      .finally(() => setLoading(false));
  }, [status]);

  useEffect(() => load(), [load]);

  const columns = useMemo<ColumnDef<SupplierRefund, unknown>[]>(
    () => [
      {
        accessorKey: 'number',
        header: t('col_number'),
        cell: ({ row }) => (
          <Link href={`/supplier-refunds/${row.original.id}`} className="num text-primary hover:underline">
            {row.original.number}
          </Link>
        ),
      },
      {
        accessorKey: 'partner_name',
        header: t('supplier'),
        cell: ({ row }) => <span className="text-text">{row.original.partner_name ?? '—'}</span>,
      },
      {
        accessorKey: 'refund_date',
        header: t('refund_date'),
        cell: ({ row }) => <span className="num text-muted">{row.original.refund_date}</span>,
      },
      {
        accessorKey: 'payment_method_name',
        header: t('destination'),
        cell: ({ row }) => (
          <span className="text-muted">{row.original.payment_method_name ?? t(`method_${row.original.method}`)}</span>
        ),
      },
      {
        accessorKey: 'amount',
        header: t('col_amount'),
        cell: ({ row }) => <div className="num text-end text-text">{formatRiyal(row.original.amount)}</div>,
      },
      {
        accessorKey: 'status',
        header: t('col_status'),
        cell: ({ row }) => <Badge tone={tone[row.original.status]}>{t(`status_${row.original.status}`)}</Badge>,
      },
    ],
    [t]
  );

  const actions: PageAction[] = [
    { key: 'new', label: t('new'), icon: Plus, onClick: () => setOpen(true), variant: 'primary' },
  ];

  return (
    <div className="space-y-4">
      <PageHeader title={t('title')} description={t('subtitle')} actions={actions} />

      <div className="flex flex-wrap items-end gap-2">
        <div className="space-y-1.5">
          <Label htmlFor="refund-status">{t('col_status')}</Label>
          <Select
            id="refund-status"
            value={status}
            onChange={(event) => setStatus(event.target.value as '' | SupplierRefund['status'])}
          >
            <option value="">{t('status_all')}</option>
            <option value="draft">{t('status_draft')}</option>
            <option value="posted">{t('status_posted')}</option>
            <option value="reversed">{t('status_reversed')}</option>
          </Select>
        </div>
      </div>

      <DataTable columns={columns} data={data} loading={loading} emptyLabel={t('empty')} />

      <CreateSupplierRefundDialog open={open} onClose={() => setOpen(false)} onCreated={load} />
    </div>
  );
}
