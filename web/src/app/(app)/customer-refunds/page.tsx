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
import { CreateCustomerRefundDialog } from '@/components/customer-refunds/create-customer-refund-dialog';
import { api } from '@/lib/api';
import { formatRiyal } from '@/lib/money';

interface CustomerRefund {
  id: string;
  number: string;
  partner_name?: string | null;
  refund_date: string;
  amount: string;
  method: string;
  payment_method_name: string | null;
  status: 'draft' | 'posted' | 'reversed';
}

const tone: Record<CustomerRefund['status'], 'warning' | 'positive' | 'muted'> = {
  draft: 'warning',
  posted: 'positive',
  reversed: 'muted',
};

/**
 * استرداد العميل — خروج المال فعلاً مقابل مرتجعات مبيعات أو إشعارات دائنة
 * مرحّلة أنشأت رصيد عميل. مستقلٌّ عن المرتجع نفسه وعن سند الصرف.
 */
export default function CustomerRefundsPage() {
  const t = useTranslations('customerRefunds');
  const [data, setData] = useState<CustomerRefund[]>([]);
  const [loading, setLoading] = useState(true);
  const [status, setStatus] = useState<'' | CustomerRefund['status']>('');
  const [open, setOpen] = useState(false);

  const load = useCallback(() => {
    setLoading(true);
    const query = status ? `?status=${status}` : '';
    api<{ data: CustomerRefund[] }>(`/customer-refunds${query}`)
      .then((response) => setData(response.data))
      .finally(() => setLoading(false));
  }, [status]);

  useEffect(() => load(), [load]);

  const columns = useMemo<ColumnDef<CustomerRefund, unknown>[]>(
    () => [
      {
        accessorKey: 'number',
        header: t('col_number'),
        cell: ({ row }) => (
          <Link href={`/customer-refunds/${row.original.id}`} className="num text-primary hover:underline">
            {row.original.number}
          </Link>
        ),
      },
      {
        accessorKey: 'partner_name',
        header: t('customer'),
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
          <Label htmlFor="customer-refund-status">{t('col_status')}</Label>
          <Select
            id="customer-refund-status"
            value={status}
            onChange={(event) => setStatus(event.target.value as '' | CustomerRefund['status'])}
          >
            <option value="">{t('status_all')}</option>
            <option value="draft">{t('status_draft')}</option>
            <option value="posted">{t('status_posted')}</option>
            <option value="reversed">{t('status_reversed')}</option>
          </Select>
        </div>
      </div>

      <DataTable columns={columns} data={data} loading={loading} emptyLabel={t('empty')} />

      <CreateCustomerRefundDialog open={open} onClose={() => setOpen(false)} onCreated={load} />
    </div>
  );
}
