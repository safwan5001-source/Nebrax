'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { type ColumnDef } from '@tanstack/react-table';
import { Plus } from 'lucide-react';
import { DataTable } from '@/components/data-table';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { BranchViewToggle } from '@/components/ui/branch-view-toggle';
import { PaymentDialog } from '@/components/payments/payment-dialog';
import { api } from '@/lib/api';
import { branchViewQuery, type BranchView } from '@/lib/branch-view';
import { formatRiyal } from '@/lib/money';

interface Payment {
  id: string;
  number: string;
  partner_id: string;
  method: string;
  status: string;
  payment_date: string;
  amount: string;
}
interface Partner { id: string; name: string }

/**
 * مدفوعات الموردين — سندات الصرف (`direction=paid`).
 * التفاصيل تُفتح على شاشة السند المشتركة `/payments/[id]`.
 */
export default function SupplierPaymentsPage() {
  const t = useTranslations('payments');
  const tsp = useTranslations('supplierPayments');
  const ts = useTranslations('status');
  const [data, setData] = useState<Payment[]>([]);
  const [partners, setPartners] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(true);
  const [open, setOpen] = useState(false);

  // نطاق العرض: الفرع النشط افتراضياً؛ لا يُحفظ فيبدأ كل فتح من الافتراضي.
  const [view, setView] = useState<BranchView>('current');

  const load = useCallback(() => {
    setLoading(true);
    Promise.all([
      api<{ data: Payment[] }>(`/payments?direction=paid${branchViewQuery(view, true)}`),
      api<{ data: Partner[] }>('/partners?type=supplier'),
    ])
      .then(([pay, prt]) => {
        setData(pay.data);
        setPartners(Object.fromEntries(prt.data.map((p) => [p.id, p.name])));
      })
      .finally(() => setLoading(false));
  }, [view]);

  useEffect(() => load(), [load]);

  const columns = useMemo<ColumnDef<Payment, unknown>[]>(
    () => [
      {
        accessorKey: 'number',
        header: t('number'),
        cell: ({ row }) => (
          <Link href={`/payments/${row.original.id}`} className="num text-primary hover:underline">
            {row.original.number}
          </Link>
        ),
      },
      {
        id: 'partner',
        header: tsp('supplier'),
        accessorFn: (r) => partners[r.partner_id] ?? '—',
        cell: ({ row }) => partners[row.original.partner_id] ?? '—',
      },
      { accessorKey: 'payment_date', header: t('date'), cell: ({ row }) => <span className="num text-muted">{row.original.payment_date}</span> },
      { accessorKey: 'method', header: t('method'), cell: ({ row }) => <Badge tone="muted">{t(row.original.method)}</Badge> },
      { accessorKey: 'amount', header: t('amount'), cell: ({ row }) => <div className="num text-end">{formatRiyal(row.original.amount)}</div> },
      { accessorKey: 'status', header: t('status'), cell: ({ row }) => <Badge tone={row.original.status === 'posted' ? 'positive' : 'muted'}>{ts(row.original.status)}</Badge> },
    ],
    [partners, t, tsp, ts]
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-xl font-semibold text-text">{tsp('title')}</h1>
        {/* نطاق العرض ظاهر في الشاشة نفسها — لا مخفيّاً في الإعدادات. */}
        <BranchViewToggle value={view} onChange={setView} />
        <Button onClick={() => setOpen(true)}>
          <Plus className="h-4 w-4" strokeWidth={1.8} />
          {tsp('create')}
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={data}
        loading={loading}
        searchPlaceholder={tsp('search')}
        emptyLabel={tsp('empty')}
        exportName="supplier-payments"
      />

      <PaymentDialog open={open} onClose={() => setOpen(false)} onSaved={load} fixedDirection="paid" />
    </div>
  );
}
